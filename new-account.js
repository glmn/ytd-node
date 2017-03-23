const Youtube = require("youtube-api")
const fs = require("fs");
const readJson = require("r-json");
const Lien = require("lien");
const debug = require("bug-killer");
const opn = require("opn");
const prettyBytes = require("pretty-bytes");
const Promise = require('bluebird');

var Accounts = require('./accounts.js');
var accounts = new Accounts();
debug.warn(accounts);

const CREDENTIALS = readJson(`${__dirname}/credentials.json`);

let server = new Lien({
    host: "localhost"
  , port: 5000
});

let oauth = Youtube.authenticate({
    type: "oauth"
  , client_id: CREDENTIALS.web.client_id
  , client_secret: CREDENTIALS.web.client_secret
  , redirect_url: CREDENTIALS.web.redirect_uris[0]
});

accounts.db.on('open', () => {  
    opn(oauth.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: ["https://www.googleapis.com/auth/youtube.upload"]
    }));

    server.addPage("/oauth2callback", lien => {
        oauth.getToken(lien.query.code, (err, tokens) => {

            if (err) {
                lien.lien(err, 400);
                return debug.log(err);
            }

            Promise.resolve(tokens)
                .then(tokens => {
                    accounts.insertNew(tokens);
                });
        })
    });
});