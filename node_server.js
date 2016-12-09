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

// var redis_url = 'redis://' + config.redis.host + ':' + config.redis.port + '/0';
var redis_url = 'redis://redis:6379/0';
console.log("redis url " + redis_url)

var celery = require('node-celery'),
    client = celery.createClient({
        // CELERY_BROKER_URL: 'redis://localhost:6379/0',
        // CELERY_RESULT_BACKEND: 'redis://localhost:6379/0',
        CELERY_BROKER_URL: redis_url,
        CELERY_RESULT_BACKEND: redis_url,
        CELERY_ROUTES: {
            'tasks.removeUserJobsFromQueue': {
                queue: 'manager'
            },
            'tasks.chemaxonTask': {
                queue: 'chemaxon'
            },
            'tasks.sparcTask': {
                queue: 'sparc'
            },
            'tasks.epiTask': {
                queue: 'epi'
            },
            'tasks.testTask': {
                queue: 'test'
            },
            'tasks.measuredTask': {
                queue: 'measured'
            }
        }
    });
    client.on('error', function(err) {
        console.log(err);
    });

var express = require('express');
var app = express()
    , server = http.createServer(app)
    , io = io.listen(server);

// var server_

server.listen(config.server.port);

app.get('/test', function(req, res){
  // res.send('hey');
  res.sendFile(path.join(__dirname + '/public/html/ws_test_page.html'));
});

// var io = require('socket.io').listen(app.listen(config.server.port));

console.log("cts_nodejs running at " + config.server.host + ", port " + config.server.port);
console.log("cts_nodejs test at /test");

// v0.12 way:
io.sockets.on('connection', function (socket) 
{// v4+ way:
// io.on('connection', function (socket) {

    console.log("session id: " + socket.id);

    // ??? was this a thing when it was all working???
    var message_client = redis.createClient(redis_url);
    // var message_client = redis.createClient();
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
        // console.log(message);

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
        console.log("A socket error occured in cts_nodejs..");
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
        client.call('tasks.test_celery', [socket.id, 'hello celery'], function(result) {
            console.log(result);
            client.end();
        });

    });

});


function parseRequestsToCeleryWorkers(sessionid, data_obj) {

    if ('cancel' in data_obj) {
        client.call('tasks.removeUserJobsFromQueue', [sessionid]);
        // could send cancel notification to user..
        return;
    }

    var user_jobs = [];

    console.log("DATA OBJ: " + JSON.stringify(data_obj));

    if ('nodes' in data_obj) {
        for (node in data_obj['nodes']) {
            var node_obj = data_obj['nodes'][node];
            // todo: use new obj don't recycle data_obj it's confusing..
            data_obj['node'] = node_obj;
            data_obj['chemical'] = node_obj['smiles'];
            jobID = pchemRequestHandler(sessionid, data_obj);
            // user_jobs.push(jobID);
        }
    }
    else {
        jobID = pchemRequestHandler(sessionid, data_obj);
        // user_jobs.push(jobID);
    }
    
}


function pchemRequestHandler(sessionid, data_obj) {

    for (var calc in data_obj['pchem_request']) {

        data_obj['calc'] = calc;
        data_obj['props'] = data_obj['pchem_request'][calc];
        data_obj['sessionid'] = sessionid;

        if (calc == 'chemaxon') {
            client.call('tasks.chemaxonTask', [data_obj]);
        }
        else if (calc == 'sparc') {
            client.call('tasks.sparcTask', [data_obj]);   
        }
        else if (calc == 'epi') {
            client.call('tasks.epiTask', [data_obj]);   
        }
        else if (calc == 'test') {
            client.call('tasks.testTask', [data_obj]);   
        }
        else if (calc == 'measured') {
            client.call('tasks.measuredTask', [data_obj]);   
        }

    }

    return sessionid;  // session ID used for job ID

}
 


// function passRequestToCTS (values) {
//     var options = {
//         host: config.cts.host,
//         port: config.cts.port,
//         path: config.cts.path,
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/x-www-form-urlencoded',
//             'Content-Length': values.length
//         }
//     };
//     // Send message to CTS server:
//     var req = http.request(options, function(res){
//         res.setEncoding('utf8');        
//         // Print out error message:
//         res.on('data', function(message){
//             if(message != 'Everything worked :)'){
//                 console.log('Message: ' + message);
//             } 
//         });
//     });
//     req.write(values);
//     req.end();
// }