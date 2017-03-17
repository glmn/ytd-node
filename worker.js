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
	photos_temp = 'temp/photos',
	videos_temp = 'temp/videos',
	sounds_path = 'assets/sounds',
	images_path = 'assets/img',
	hotellook_api = 'http://photo.hotellook.com/image_v2/crop/h{id}_{photo_id}/1280/720.jpg'
	description_link = 'http://h.glmn.io/';

socket.on('connect', function(){
	socket.emit('hotel-request');
	socket.on('hotel-response', function(hotel){
		Promise.resolve(hotel)
			   .then(Worker.makePhotosDir)
			   .then(Worker.downloadAllPhotos)
		//dwn all photos
		//make video
		//upload to youtube
	})
})

class Worker {

	static makePhotosDir(hotel)
	{
		return new Promise(function(resolve,reject){
			var folder = path.join(photos_temp,hotel.id);
			fs.stat(folder, function (err, stats){
				if (err) {
					return new Promise(function(resolve,reject){
						fs.mkdir(folder, function(){
							resolve([folder,hotel]);
						});	
					});
				}

				if (!stats.isDirectory()) {
					reject(new Error('temp is not a directory!'));
				} else {
					resolve([folder,hotel]);
				}
			});
		});
	}

	static downloadAllPhotos(args)
	{
		return new Promise(function(resolve,reject){
			[folder,hotel] = args;

			var promises = [];
			var photosUrls = [];

			for(var i = 1; i <= hotel.photos_count; i++){
				photosUrls.push(
					hotellook_api.replace('{id}', hotel.id)
							   	 .replace('{photo_id}', i)
				)
			}

			photosUrls.forEach(function(photoUrl, index){
				promises.push(self.downloadPhoto(hotel, photoUrl, folder, index));
			});

			Promise.all(promises)
				.then(function(){
			        debug.log(hotel.name + ' => all photos downloaded');
					resolve([hotel,folder])
				})
				.catch(reject);
		});
	}

	static downloadPhoto(hotel, photoUrl, folder, index)
	{
		return new Promise(function(resolve,reject){
			var request = http.get(photoUrl, function (response) {
				var f = fs.createWriteStream(path.join(folder,index + '.jpg'));
				response.on('data', function (chunk) {
			        f.write(chunk);
			    }).on('end',function(){
			        f.end();
			        resolve(hotel);
			    });
			});
		});
	}
}