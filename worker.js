"use strict";

var socket		= require("socket.io-client")('http://localhost:3000'),
	prettyBytes = require("pretty-bytes"),
	youtube   	= require("youtube-api"),
	debug 	  	= require("bug-killer"),
	videoshow 	= require('videoshow'),
	Promise   	= require('bluebird'),
	request   	= require('request'),
	readJson  	= require("r-json"),
	rmdir 	  	= require('rimraf'),
	http 	  	= require('http'),
	path	  	= require('path'),
	junk 	  	= require('junk'),
	opn 	  	= require("opn"),
	fs		  	= require("fs");
	require('dotenv').config();
	
const
	upload_delay = process.env.UPLOAD_DELAY || 60 * 60 * 12,
	upload_limit = process.env.UPLOAD_LIMIT || 50,
	photos_limit = process.env.PHOTOS_LIMIT || 10,
	photos_temp = 'temp/photos',
	videos_temp = 'temp/videos',
	sounds_path = 'assets/sounds',
	images_path = 'assets/img',
	hotellook_api = process.env.HOTELLOOK_API || 'http://photo.hotellook.com/image_v2/crop/h{id}_{photo_id}/1280/720.jpg',
	redirect_link = process.env.REDIRECT_LINK || 'http://h.glmn.io/',
	CREDENTIALS = readJson('credentials.json');

var uploaded_videos = 0;

var	video_description = [
	"Book it now with up to 20% discount - " + redirect_link + "{hotel_id} \n\n",
	"{hotel_name} review",
	"{hotel_name} price",
	"{hotel_name} discount",
	"{hotel_name} video",
	"{hotel_name} reviews"
];
var oauth = youtube.authenticate({
    type: "oauth",
 	access_token: process.env.ACCESS_TOKEN,
	refresh_token: process.env.REFRESH_TOKEN,
	client_id: CREDENTIALS.web.client_id,
	client_secret: CREDENTIALS.web.client_secret,
	redirect_url: CREDENTIALS.web.redirect_uris[0]
});


socket.on('connect', () => {

	socket.emit('worker:hotel-request');

	socket.on('worker:hotel-response', (hotel) => {

		Promise.resolve()
			   .then(() => {
			   		Worker.emitStatus('Refreshing YouTube token');
			   })
			   .then(Worker.youtubeRefreshToken)
			   .then(() => {
			   		Worker.emitStatus('Making photos temp directory');
			   		return hotel;
			   })
			   .then(Worker.makePhotosDir)
			   .then(([folder,hotel]) => {
			   		Worker.emitStatus('Downloading photos');
			   		return [folder,hotel];
			   })
			   .then(Worker.downloadAllPhotos)
			   .then(([folder,hotel]) => {
			   		Worker.emitStatus('Making video');
			   		return [folder,hotel];
			   })
			   .then(Worker.makeVideo)
			   .then(([hotel,video]) => {
			   		Worker.emitStatus('Uploading video to YouTube');
			   		return [hotel,video];
			   })
			   .then(Worker.youtubeUpload)
			   .then(() => {
			   		uploaded_videos += 1;
			   		if(uploaded_videos == upload_limit)
			   		{
			   			setTimeout(() => {
							socket.emit('worker:hotel-request');
			   			}, upload_delay);
			   		}else{
						socket.emit('worker:hotel-request');
			   		}
			   })
			   .catch(debug.warn)
	})
})








class Worker {

	static makePhotosDir(hotel)
	{
		return new Promise((resolve,reject) => {
			var folder = path.join(photos_temp,hotel.id);
			fs.stat(folder, (err, stats) => {
				if (err) {
					return resolve(Worker.mkDir(folder,hotel))
				}

				if (!stats.isDirectory()) {
					reject(new Error('temp is not a directory!'));
				} else {
					resolve([folder,hotel]);
				}
			});
		});
	}

	static mkDir(folder,hotel)
	{
		return new Promise((resolve,reject) => {
			fs.mkdir(folder, () => {
				resolve([folder,hotel]);
			});	
		});
	}

	static downloadAllPhotos(args)
	{
		return new Promise((resolve,reject) => {
			var [folder,hotel] = args;
			debug.log(folder,hotel);
			var promises = [];
			var photoUrls = [];

			for(var i = 1; i <= (hotel.photos_count > photos_limit ? photos_limit : hotel.photos_count) ; i++){
				photoUrls.push(
					hotellook_api.replace('{id}', hotel.id)
							   	 .replace('{photo_id}', i)
				)
			}

			photoUrls.forEach((photoUrl, index) => {
				promises.push(Worker.downloadPhoto(hotel, photoUrl, folder, index));
			});

			Promise.all(promises)
				.then(() => {
			        debug.log(hotel.name + ' => all photos downloaded');
					resolve([hotel,folder])
				})
				.catch(reject);
		});
	}

	static downloadPhoto(hotel, photoUrl, folder, index)
	{
		return new Promise((resolve,reject) => {
			var request = http.get(photoUrl, (response) => {
				var f = fs.createWriteStream(path.join(folder,index + '.jpg'));
				response.on('data', (chunk) => {
			        f.write(chunk);
			    }).on('end', () => {
			        f.end();
			        resolve(hotel);
			    });
			});
		});
	}

	static makeVideo(args)
	{
		return new Promise((resolve,reject) => {
			var [hotel,folder] = args;

			var videoOptions = {
				fps: 25,
				loop: 4, // seconds
				transition: true,
				transitionDuration: 1, // seconds
				videoBitrate: 1024,
				videoCodec: 'libx264',
				size: '1280x720',
				audioBitrate: '128k',
				audioChannels: 2,
				format: 'mp4',
				pixelFormat: 'yuv420p'
			};

			var watermark = path.join(images_path,'watermark.png');
			var watermarkOptions = { start: 0, end: 999, xAxis: 0, yAxis: 0 };

			Worker.getPhotosFromFolder(folder).then((photos) => {
				Worker.chooseSound().then((audio) => {
					var video_output = path.join(videos_temp, hotel.id + '.mp4');
					videoshow(photos, videoOptions)
						.audio(audio)
						.logo(watermark,watermarkOptions)
						.save(video_output)
						.on('start', () => {
				        	console.log(hotel.name + ' => making video');
						})
						.on('end', () => {
							rmdir(folder, () => {
								resolve([hotel,video_output])
							});
						})
						.on('error', (err, stdout, stderr) => {
							reject([err, stdout, stderr])
						})
				});
			});
		})
	}

	static getPhotosFromFolder(folder)
	{
		return new Promise((resolve,reject) => {
			fs.readdir(folder,(err,files) => {
				if(err) return reject(err);

				files = files.filter(junk.not).map((file) => {
					return path.join(folder, file);
				});

				resolve(files);
			});
		});
	}

	static chooseSound()
	{
		return new Promise((resolve,reject) => {
			fs.readdir(sounds_path, (err,files) => {
				if(err) reject(err);

				files = files.filter(junk.not)
				resolve(path.join(sounds_path, files[Math.floor(Math.random() * files.length)]));
			})
		})
	}

	static youtubeRefreshToken()
	{
		return new Promise(function(resolve,reject){
			oauth.refreshAccessToken(function(err, tokens){
				if(err) reject();
				resolve();
			});
		});
	}

	static youtubeUpload(args)
	{
		var [hotel,video] = args;
		return new Promise(function(resolve, reject){
			var description = video_description.join("\n");
				description = description.split("{hotel_id}").join(hotel.id)
						   				 .split("{hotel_name}").join(hotel.name);
			var req = youtube.videos.insert({
			    resource: {
			        snippet: {
			            title: hotel.name + ' - ' + hotel.country_name + ', ' + hotel.location_name + ' - Review [HD]'
			          , description: description
			        }
			      , status: {
			            privacyStatus: "public"
			        }
			    }
			  , part: "snippet,status"
			  , media: {
			        body: fs.createReadStream(video)
			    }
			}, (err, data) => {
				if(err) reject(err);
				console.log('Uploaded');
			    clearInterval(uploadlogger);
			    resolve();
			});

			var uploadlogger = setInterval(function () {
			    debug.log(`${prettyBytes(req.req.connection._bytesDispatched)} uploaded.`);
			}, 1000);
		});
	}

	static emitStatus(status)
	{
		socket.emit('worker:update-status', status);
	}


}