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
		debug.log(hotel);
		//dwn all photos
		//make video
		//upload to youtube
	})
})

