"use strict";

require('dotenv').config();
var os = require('os');
var socket = require("socket.io-client")(process.env.SOCKET_HOST);
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
var WatchJS = require("melanke-watchjs")
var watch = WatchJS.watch;
var Accounts = require('./accounts.js');
var accounts = new Accounts();

	
const delay_time = process.env.DELAY_TIME;
const upload_limit = process.env.UPLOAD_LIMIT;
const photos_limit = process.env.PHOTOS_LIMIT;
const photos_temp = 'temp/photos';
const videos_temp = 'temp/videos';
const sounds_path = 'assets/sounds';
const images_path = 'assets/img';
const hotellook_api = process.env.HOTELLOOK_API;
const redirect_link = process.env.REDIRECT_LINK;
const CREDENTIALS = readJson('credentials.json');
	
var worker = {
	droplet: {
		host: os.hostname()
	},
	current_hotel:null,
	accounts:null,
	current_account_id:null,
}

var	video_description = [
	"Book it now with up to 20% discount - " + redirect_link + "{hotel_id} \n\n",
	"{hotel_name} review",
	"{hotel_name} price",
	"{hotel_name} discount",
	"{hotel_name} video",
	"{hotel_name} reviews"
];
var oauth = youtube.authenticate();

watch(worker, function(){
	Worker.emitStatus();
})

watch(worker,'current_account_id', function(){
	oauth = youtube.authenticate({
	    type: "oauth",
	 	access_token: worker.accounts[worker.current_account_id].access_token,
		refresh_token: worker.accounts[worker.current_account_id].refresh_token,
		client_id: CREDENTIALS.web.client_id,
		client_secret: CREDENTIALS.web.client_secret,
		redirect_url: CREDENTIALS.web.redirect_uris[0]
	});

	Worker.youtubeRefreshToken();
})

accounts.db.on('open',() => {
	accounts.fetchAll().then(rows => {
		accounts.list = rows;
		worker.accounts = accounts.list;
	})
	.then(() => {
		return accounts.selectFirst();
	})
	.then(() => {
		worker.current_account_id = accounts.currentIndex;

		socket.on('connect', () => {

			socket.emit('worker:hello', worker);
			socket.emit('worker:hotel-request');
			socket.on('worker:hotel-response', (hotel) => {

				worker.current_hotel = hotel;

				Promise.resolve()
					.then(() => {
							accounts.current.status = 'create temp folder';
							return hotel;
					})
					.then(Worker.makePhotosDir)
					.then(([folder,hotel]) => {
							accounts.current.status = 'download images'
							return [folder,hotel];
					})
					.then(Worker.downloadAllPhotos)
					.then(([folder,hotel]) => {
							accounts.current.status = 'render'
							return [folder,hotel];
					})
					.then(Worker.makeVideo)
					.then(([hotel,video]) => {
							accounts.current.status = 'prepare for upload'
							return [hotel,video];
					})
					.then(Worker.youtubeUpload)
					.catch((err) => {
						switch(err.code){
							case 503:
								accounts.current.status = 'got limit';
								Worker.selectNextAccount();
								break;
							default:
								accounts.current.status = 'unknown error: ' + err.code;
								Worker.selectNextAccount();
								break;
						}
					})
					.then(([hotel,video]) => {

							Worker.emitHotelStatusComplete(hotel,video);
							
							accounts.current.uploaded_videos += 1;
							accounts.current.total_uploaded_videos += 1;
							accounts.current.last_uploaded = Math.round(new Date().getTime() / 1000);

							accounts.updateCurrent();

							
							if(accounts.current.uploaded_videos >= upload_limit)
							{
								accounts.current.status = 'upload limit'
								accounts.current.uploaded_videos = 0;

								Worker.selectNextAccount();
							}else{
								socket.emit('worker:hotel-request');
							}
					})
					.catch(debug.warn)
			})
		})

	});
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
						.on('start', () => {})
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
			    clearInterval(uploadlogger);
			    resolve([hotel,data]);
			});

			var uploadlogger = setInterval(function () {
			    accounts.current.status = `uploaded ${prettyBytes(req.req.connection._bytesDispatched)}`;
			}, 1000);
		});
	}

	static emitStatus()
	{
		socket.emit('worker:update-status', worker);
	}

	static emitHotelStatusComplete(hotel,video)
	{
		socket.emit('worker:hotel-status-complete', [hotel,video]);
	}

	static selectNextAccount()
	{
		if(accounts.nextExists()){
			accounts.next();
			worker.current_account_id = accounts.currentIndex;
			socket.emit('worker:hotel-request');
		}else{
			accounts.selectFirst();
			worker.current_account_id = accounts.currentIndex;

			var time_diff = (Math.round(new Date().getTime() / 1000)) - accounts.current.last_uploaded;

			if(time_diff >= delay_time / 1000){
				socket.emit('worker:hotel-request');
			}else{
				var delay = delay_time - (time_diff * 1000);
				accounts.current.status = 'sleep'
				setTimeout(() => {
					socket.emit('worker:hotel-request');
				}, delay);
			}
		}
	}
}