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

const
	photos_limit = 10,
	photos_temp = 'temp/photos',
	videos_temp = 'temp/videos',
	sounds_path = 'assets/sounds',
	images_path = 'assets/img',
	hotellook_api = 'http://photo.hotellook.com/image_v2/crop/h{id}_{photo_id}/1280/720.jpg',
	description_link = 'http://h.glmn.io/';

socket.on('connect', () => {
	socket.emit('worker:hotel-request');
	socket.on('worker:hotel-response', (hotel) => {
		Promise.resolve(hotel)
			   .then(Worker.makePhotosDir)
			   .then(([folder,hotel]) => {
			   		socket.emit('worker:update-status', 'Created photos temp directory');
			   		return [folder,hotel];
			   })
			   .then(Worker.downloadAllPhotos)
			   .catch(debug.warn)
		//dwn all photos
		//make video
		//upload to youtube
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
}