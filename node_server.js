// CTS_NODEJS Server
// Handles CTS Frontend web sockets and
// redis subscribe events. Pushes data
// to user.


var config = require('./config');

var querystring = require('querystring');
var redis = require('redis');
var http = require('http');
var io = require('socket.io');
var path = require('path');

var celery = require('node-celery'),
    client = celery.createClient({
        CELERY_BROKER_URL: 'redis://localhost:6379/0',
        CELERY_RESULT_BACKEND: 'redis://localhost:6379/0',
        CELERY_ROUTES: {
            'celery_cts.tasks.chemaxonTask': {
                queue: 'chemaxon'
            },
            'celery_cts.tasks.sparcTask': {
                queue: 'sparc'
            },
            'celery_cts.tasks.epiTask': {
                queue: 'epi'
            },
            'celery_cts.tasks.testTask': {
                queue: 'test'
            },
            'celery_cts.tasks.measuredTask': {
                queue: 'measured'
            }
        }
    }),
    client.on('error', function(err) {
        console.log(err);
    });

var express = require('express');
var app = express()
    , server = http.createServer(app)
    , io = io.listen(server);

server.listen(config.server.port);

app.get('/test', function(req, res){
  // res.send('hey');
  res.sendFile(path.join(__dirname + '/public/html/ws_test_page.html'));
});

// var io = require('socket.io').listen(app.listen(config.server.port));

console.log("cts_nodejs running at " + config.server.host + ", port " + config.server.port);
console.log("cts_nodejs test at /test");

// v0.12 way:
io.sockets.on('connection', function (socket) {
// v4+ way:
// io.on('connection', function (socket) {

    console.log("session id: " + socket.id);

    var message_client = redis.createClient();
    // console.log("nodejs connected to redis..");

    message_client.subscribe(socket.id); // create channel with client's socket id
    // console.log("subscribed to channel " + socket.id);
    
    // Grab message from Redis that was created by django and send to client
    message_client.on('message', function(channel, message){
        // console.log("reading message from redis on channel: " + channel);
        console.log("messaged received from django-cts via redis sub")
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

        // passRequestToCTS(query);
        parseRequestsToCeleryWorkers(socket.id, message_obj);

    });

    socket.on('disconnect', function () {
        console.log("user " + socket.id + " disconnected..");
        message_client.unsubscribe(socket.id); // unsubscribe from redis channel
        var message_obj = {'cancel': true};  // cancel user's jobs

        var query = querystring.stringify({
            sessionid: socket.id,
            message: JSON.stringify(message_obj)
        });

        // passRequestToCTS(query);
        parseRequestsToCeleryWorkers(socket.id, message_obj);

    });

    socket.on('error', function () {
        // console.log("An error occured");
        console.log("%%%% AND ERROR OCCURRED %%%%")
    });

    socket.on('test_socket', function (message) {
        console.log("node received message: ");
        console.log(message);
        socket.send("hello from nodejs! at " + config.server.host + ", port " + config.server.port);
    });

    // test django-cts celery worker
    socket.on('test_celery', function (message) {
        console.log("received message: " + message);
        var query = querystring.stringify({
            sessionid: socket.id, // cts will now publish to session channel
            message: "hello celery"
        });
        // passRequestToCTS(query);
        client.call('celery_cts.tasks.test_celery', [socket.id, 'hello celery'], function(result) {
            console.log(result);
            client.end();
        });

    });

});


function parseRequestsToCeleryWorkers(sessionid, data_obj) {

    for (var calc in data_obj['pchem_request']) {

        data_obj['calc'] = calc;
        data_obj['props'] = data_obj['pchem_request'][calc];
        data_obj['sessionid'] = sessionid;

        if (calc == 'chemaxon') {
            client.call('celery_cts.tasks.chemaxonTask', [data_obj]);
        }
        else if (calc == 'sparc') {
            client.call('celery_cts.tasks.sparcTask', [data_obj]);   
        }
        else if (calc == 'epi') {
            client.call('celery_cts.tasks.epiTask', [data_obj]);   
        }
        else if (calc == 'test') {
            client.call('celery_cts.tasks.testTask', [data_obj]);   
        }
        else if (calc == 'measured') {
            client.call('celery_cts.tasks.measuredTask', [data_obj]);   
        }

    }

}
 


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