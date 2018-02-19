// CTS_NODEJS Server
// Handles CTS Frontend web sockets and
// redis subscribe events. Pushes data
// to user!


var config = require('./config');
var querystring = require('querystring');
var redis = require('redis');
var http = require('http');
var io = require('socket.io');
var path = require('path');
var express = require('express');

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
            'tasks.test_celery': {
                queue: 'manager'
            },
            'tasks.chemaxon_task': {
                queue: 'chemaxon'
            },
            'tasks.sparc_task': {
                queue: 'sparc'
            },
            'tasks.epi_task': {
                queue: 'epi'
            },
            'tasks.test_task': {
                queue: 'test'
            },
            'tasks.measured_task': {
                queue: 'measured'
            },
            'tasks.metabolizer_task': {
                queue: 'metabolizer'
            },
            'tasks.cheminfo_task': {
                queue: 'cheminfo'
            }
        }
    });
    
    client.on('error', function(err) {
        console.log(err);
    });

var app = express()
    , server = http.createServer(app)
    , io = io.listen(server);

var nodejs_port = config.server.port;
var nodejs_host = config.server.host;

server.listen(nodejs_port);

app.get('/test', function(req, res){
  // opens test page for nodejs->celery connection
  res.sendFile(path.join(__dirname + '/public/html/ws_test_page.html'));
});

console.log("cts_nodejs running at " + nodejs_host + ", port " + nodejs_port);
console.log("cts_nodejs test at /test");


io.sockets.on('connection', function (socket) 
{

    console.log("session id: " + socket.id);

    var message_client = redis.createClient(redis_url);
    // var message_client = redis.createClient();
    // console.log("nodejs connected to redis..");

    message_client.subscribe(socket.id); // create channel with client's socket id
    // console.log("subscribed to channel " + socket.id);
    
    // Grab message from Redis that was created by django and send to client
    message_client.on('message', function(channel, message){
        console.log("messaged received from celery worker via redis sub..")
        socket.send(message); // send to browser
    });
    
    
    socket.on('get_data', function (message) {
        // Request event from CTS Frontend

        console.log("nodejs server received message..");

        var message_obj = JSON.parse(message);  // parse json str to obj

        var values = {};
        for (var key in message_obj) {
            if (message_obj.hasOwnProperty(key)) {
                if (key == 'props') {
                    values[key + '[]'] = message_obj[key];  // fix for keys like: 'keyname[]' 
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

        parseCTSRequestToCeleryWorkers(socket.id, message_obj, client);  // here we go...

    });

    socket.on('disconnect', function () {

        console.log("user " + socket.id + " disconnected..");
        message_client.unsubscribe(socket.id); // unsubscribe from redis channel
        var message_obj = {'cancel': true};  // cancel user's jobs

        var query = querystring.stringify({
            sessionid: socket.id,
            message: JSON.stringify(message_obj)
        });

        console.log("Calling manager worker to cancel user job upon disconnect..");
        client.call('tasks.manager_task', [socket.id]);

        return;

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


function parseCTSRequestToCeleryWorkers(sessionid, data_obj, client) {
    // TODO: Change name to old func name once it's working!

    data_obj['sessionid'] = sessionid;  // add sessionid to data object
    calc = data_obj['calc'];

    if ('cancel' in data_obj) {
        client.call('tasks.manager_task', [sessionid]);
        // could send cancel notification to user..
        console.log("Calling manager worker to cancel user job upon disconnect...");
        return;
    }

    if (data_obj['service'] == 'getSpeciationData') {
        console.log("calling chemaxon worker for speciation data..");
        client.call('tasks.chemaxon_task', [data_obj]);
    }
    else if (data_obj['service'] == 'getTransProducts') {
        console.log("calling metabolizer worker for transformation products");
        client.call('tasks.metabolizer_task', [data_obj]);
    }
    else if (data_obj['service'] == 'getChemInfo') {
        console.log("calling chem info worker..");
        client.call('tasks.cheminfo_task', [data_obj]);
    }
    else {
        // Breaking user request up by calc, send to
        // the respective calc celery workers:
        for (var calc in data_obj['pchem_request']) {
            data_obj['calc'] = calc;
            if (calc == 'chemaxon') {
                console.log("sending request to chemaxon worker");
                client.call('tasks.chemaxon_task', [data_obj]);
            }
            else if (calc == 'sparc') {
                console.log("sending request to sparc worker");
                client.call('tasks.sparc_task', [data_obj]);
            }
            else if (calc == 'epi') {
                console.log("sending request to epi worker");
                client.call('tasks.epi_task', [data_obj]);
            }
            else if (calc == 'test') {
                console.log("sending request to test worker");
                client.call('tasks.test_task', [data_obj]);
            }
            else if (calc == 'measured') {
                console.log("sending request to measured worker");
                client.call('tasks.measured_task', [data_obj]);  
            }
        }
    }
    
}
