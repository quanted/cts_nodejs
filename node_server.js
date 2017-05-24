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

var chemaxon_kow_methods = ['KLOP', 'VG', 'PHYS'];

var redis_url = 'redis://' + config.redis.host + ':' + config.redis.port + '/0';  // uses env vars, or defaults to localhost

console.log("redis url " + redis_url)

var celery = require('node-celery'),
    client = celery.createClient({
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
            },
            'tasks.metabolizerTask': {
                queue: 'metabolizer'
            },
            'tasks.chemInfoTask': {
                queue: 'cheminfo'
            }
        //     'tasks.calcTask': {
        //         queue: 'chemaxon'
        //     }
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

var nodejs_port = config.server.port;
var nodejs_host = config.server.host;

server.listen(nodejs_port);

app.get('/test', function(req, res){
  // res.send('hey');
  res.sendFile(path.join(__dirname + '/public/html/ws_test_page.html'));
});

// var io = require('socket.io').listen(app.listen(process.env.port));

console.log("cts_nodejs running at " + nodejs_host + ", port " + nodejs_port);
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
        parseRequestsToCeleryWorkers(socket.id, message_obj, client);

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
        parseRequestsToCeleryWorkers(socket.id, message_obj, client);

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


function parseRequestsToCeleryWorkers(sessionid, data_obj, client) {

    if ('cancel' in data_obj) {
        client.call('tasks.removeUserJobsFromQueue', [sessionid]);
        // could send cancel notification to user..
        console.log("Calling manager worker to cancel user job upon disconnect...");
        return;
    }

    var user_jobs = [];

    console.log("DATA OBJ: " + JSON.stringify(data_obj));

    if ('nodes' in data_obj) {
        for (node in data_obj['nodes']) {
            var node_obj = data_obj['nodes'][node];
            data_obj['node'] = node_obj;
            data_obj['chemical'] = node_obj['smiles'];
            data_obj['mass'] = node_obj['mass'];
            jobID = requestHandler(sessionid, data_obj, client);
        }
    }
    else {
        jobID = requestHandler(sessionid, data_obj, client);
    }
    
}


function requestHandler(sessionid, data_obj, client) {

    data_obj['sessionid'] = sessionid;

    console.log("Service: " + data_obj['service']);

    if (data_obj['service'] == 'getSpeciationData') {
        // chemspec batch and gentrans batch services
        // data_obj['sessionid'] = sessionid;
        client.call('tasks.chemaxonTask', [data_obj]);
        // client.call('tasks.calcTask', [data_obj]);
        return sessionid;
    }
    else if (data_obj['service'] == 'getTransProducts') {
        console.log("calling metabolizer worker for transformation products");
        client.call('tasks.metabolizerTask', [data_obj]);
        return sessionid;
    }
    else if (data_obj['service'] == 'getChemInfo') {
        console.log("calling chem info worker..");
        client.call('tasks.chemInfoTask', [data_obj]);
        return sessionid;
    }
    else {

        callPchemWorkers(sessionid, data_obj, client);  // sends requests to pchem workers
        return sessionid;

    }

}


function callPchemWorkers(sessionid, data_obj, client) {
    for (var calc in data_obj['pchem_request']) {

        var props = data_obj['pchem_request'][calc];

        data_obj['calc'] = calc;
        // data_obj['props'] = data_obj['pchem_request'][calc];
        // data_obj['sessionid'] = sessionid;

        for (var prop_index = 0; prop_index < props.length; prop_index++) {

            var prop = props[prop_index];

            console.log("props " + props);
            console.log("prop " + prop);

            data_obj['prop'] = prop;

            var is_chemaxon = calc == 'chemaxon';
            var is_kow = prop == 'kow_no_ph' || prop == 'kow_wph';
            if (is_chemaxon && is_kow) {
                // chemaxon kow has values for 3 different methods
                // note: this'll be in consumer.py and use the calc classes,
                // so it can grab the methods from there..
                for (var i = 0; i < chemaxon_kow_methods.length; i++) {
                    data_obj['method'] = chemaxon_kow_methods[i];
                    console.log("CHEMAXON KOW METHOD: " + chemaxon_kow_methods[i]);
                    client.call('tasks.chemaxonTask', [data_obj]);
                }
            }
            else {

                if (calc == 'chemaxon') {
                    console.log("sending request to chemaxon task");
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
        }
    }
}