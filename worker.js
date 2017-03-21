"use strict";

var socket = require("socket.io-client")('http://localhost:3000');
var prettyBytes = require("pretty-bytes");
var youtube = require("youtube-api");
var debug = require("bug-killer");
var videoshow = require('videoshow');
var Promise = require('bluebird');
var request = require('request');
var readJson = require("r-json");
var rmdir = require('rimraf');
var http = require('http');
var path = require('path');
var junk = require('junk');
var opn = require("opn");
var fs = require("fs");
var sqlite = require('sqlite3').verbose();

require('dotenv').config();
	
const delay_time = process.env.DELAY_TIME || 60 * 60 * 12;
const upload_limit = process.env.UPLOAD_LIMIT || 50;
const photos_limit = process.env.PHOTOS_LIMIT || 10;
const photos_temp = 'temp/photos';
const videos_temp = 'temp/videos';
const sounds_path = 'assets/sounds';
const images_path = 'assets/img';
const hotellook_api = process.env.HOTELLOOK_API;
const redirect_link = process.env.REDIRECT_LINK;
const CREDENTIALS = readJson('credentials.json');
	
var worker = {
	current_hotel:null,
	uploaded_videos:0,
	total_uploaded_videos:0,
	last_uploaded:0,
	status:'Starting'
}

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

	socket.emit('worker:hello', worker);
	socket.emit('worker:hotel-request');
	socket.on('worker:hotel-response', (hotel) => {

		Promise.resolve()
			   .then(() => {
			   		worker.current_hotel = hotel;
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
			   .then(([hotel,video]) => {
			   		Worker.emitHotelStatusComplete(hotel,video);
			   		
			   		worker.uploaded_videos += 1;
			   		worker.total_uploaded_videos +=1;
			   		
			   		if(worker.uploaded_videos == upload_limit)
			   		{
		   				Worker.emitStatus('Sleeping');
			   			setTimeout(() => {
							socket.emit('worker:hotel-request');
			   			}, delay_time);
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
			            title: hotel.name + ' - ' + hotel.country_name + ', ' + hotel.location_name + ' - Review [HD]',
			          	description: description
			        },
			      	status: {
			            privacyStatus: "public"
			        }
			    },
				part: "snippet,status",
				media: {
			        body: fs.createReadStream(video)
			    }
			}, (err, data) => {
				if(err) reject(err);
				console.log('Uploaded');
			    clearInterval(uploadlogger);
			    resolve([hotel,data]);
			});

			var uploadlogger = setInterval(function () {
			    Worker.emitStatus(`Uploaded ${prettyBytes(req.req.connection._bytesDispatched)}`)
			}, 1000);
		});
	}

	static emitStatus(status)
	{
		worker.status = status;
		socket.emit('worker:update-status', worker);
	}

	static emitHotelStatusComplete(hotel,video)
	{
		socket.emit('worker:hotel-status-complete', [hotel,video]);
	}

}

class Accounts {

	constructor()
	{
		this.db = new sqlite.Database('accounts.db', sqlite.OPEN_READWRITE);
		this.currentIndex = 0
		this.current = {}
	}

	fetchAll()
	{
		return new Promise((resolve,reject) => {
			this.db.all('SELECT * FROM accounts', (err, rows) => {
				if(err) reject(err)
				resolve(rows)
			})
		})
	}

	count()
	{
		return this.list.length;
	}

	showList()
	{
		debug.log(this.list);
	}
	
	select(index)
	{
		return new Promise((resolve,reject) => {
			if(this.count == 0) reject(new Error('Zero accounts in database'))
			if(this.count-1 > index) reject(new Error('Account index out of range'))

			this.currentIndex = index;
			this.current = this.list[index];
			resolve()
		})
	}

	selectFirst()
	{
		return this.select(0);
	}
}


var accounts = new Accounts();
accounts.db.on('open',() => {
	accounts.fetchAll().then(rows => {
		accounts.list = rows;
	}).then(() => {
		return accounts.selectFirst();
	}).then(() => {
		debug.error(accounts.current)
	});
})