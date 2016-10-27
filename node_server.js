// CTS_NODEJS Server
// Handles CTS Frontend web sockets and
// redis subscribe events. Pushes data
// to user.


var config = require('./config');

var express = require('express');
var app = express();

// var http = require('http');
// var server = http.createServer().listen(config.server.port);
// var io = require('socket.io').listen(server);

var io = require('socket.io').listen(app.listen(config.server.port));

var querystring = require('querystring');
var redis = require('redis');
var http = require('http');

// v0.12 way:
io.sockets.on('connection', function (socket) {
// v4+ way:
// io.on('connection', function (socket) {

    console.log("session id: " + socket.id);

    var message_client = redis.createClient();
    console.log("nodejs connected to redis..");

    message_client.subscribe(socket.id); // create channel with client's socket id
    console.log("subscribed to channel " + socket.id);
    
    // Grab message from Redis that was created by django and send to client
    message_client.on('message', function(channel, message){
        console.log("reading message from redis on channel: " + channel);
        socket.send(message); // send to browser
    });
    
    // checked calcs/props sent from front-end:
    socket.on('get_data', function (message) {

        console.log("nodejs server received message..");
        console.log(message);

        var message_obj = JSON.parse(message);  // parse json str to obj

        var values = {};
        for (var key in message_obj) {
            if (message_obj.hasOwnProperty(key)) {
                if (key == 'props') {
                    values[key + '[]'] = message_obj[key];
                }
                else {
                    values[key] = message_obj[key];
                }
            }
        }

        var query = querystring.stringify({
            sessionid: socket.id,
            message: JSON.stringify(values)
        });

        passRequestToCTS(query);

    });

    socket.on('disconnect', function () {
        console.log("user " + socket.id + " disconnected..");
        message_client.unsubscribe(socket.id); // unsubscribe from redis channel
        var message_obj = {'cancel': true};  // cancel user's jobs

        var query = querystring.stringify({
            sessionid: socket.id,
            message: JSON.stringify(message_obj)
        });

        passRequestToCTS(query);

    });

    socket.on('error', function () {
        console.log("An error occured");
    });

});


function passRequestToCTS (values) {
    var options = {
        host: config.cts.host,
        port: config.cts.port,
        path: config.cts.path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': values.length
        }
    };
    // Send message to CTS server:
    var req = http.request(options, function(res){
        res.setEncoding('utf8');        
        // Print out error message:
        res.on('data', function(message){
            if(message != 'Everything worked :)'){
                console.log('Message: ' + message);
            } 
        });
    });
    req.write(values);
    req.end();
}