// CTS_NODEJS Server
// Handles CTS Frontend web sockets and
// redis subscribe events. Pushes data
// to user!

// Local Config:
var config = require('./config');

// External Package Requirements:
var querystring = require('querystring');
var redis = require('redis');
var http = require('http');
var io = require('socket.io');
var path = require('path');
var express = require('express');
var celery = require('node-celery');

// Define server, set socket.io server to listen on said server:
var app = express();
var server = http.createServer(app);
var io = io.listen(server);

var nodejs_port = config.server.port;  // node server port
var nodejs_host = config.server.host;  // node server host

var celery_default_timeout = config.celery.defaultTimeout;  // default timeout for celery worker calls
// var celery_default_timeout = config.celery.testingTimeout;  // default timeout for celery worker calls

var redis_url = 'redis://' + config.redis.host + ':' + config.redis.port + '/0';  // url for redis instance
// var redisClient = redis.createClient(redis_url);
var redisManager = redis.createClient(redis_url);
console.log("redis running at " + redis_url);


server.listen(nodejs_port);  // Start Express server
console.log("Server started.. \nTest page at http://" + nodejs_host + ":" + nodejs_port + "/test");


// Create Celery celeryClient:
var celeryClient = celery.createClient({
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
    
celeryClient.on('error', function(err) {
    console.log("An error occurred calling the celery worker: " + err);
});


// Celery worker test endpoint:
app.get('/test', function(req, res){
  // opens test page for nodejs->celery connection
  res.sendFile(path.join(__dirname + '/public/html/ws_test_page.html'));
});


io.sockets.on('connection', function (socket) 
{

    console.log("session id: " + socket.id);

    var redisClient = redis.createClient(redis_url);
    // console.log("nodejs connected to redis..");

    redisClient.subscribe(socket.id); // create channel with celeryClient's socket id
    // console.log("subscribed to channel " + socket.id);
    
    // Grab message from Redis that was created by django and send to celeryClient
    redisClient.on('message', function(channel, message){
        console.log(">>> messaged received from celery worker via redis sub..")
        console.log("Channel: " + channel);
        // console.log("Message: " + message);
        socket.send(message); // send to browser
    });
    
    
    socket.on('get_data', function (message) {
        // Request event from CTS Frontend

        console.log("nodejs server received message..");

        var message_obj = JSON.parse(message);  // parse json str to obj
        parseCTSRequestToCeleryWorkers(socket.id, message_obj, socket);  // here we go...

    });

    socket.on('disconnect', function (err) {
        /*
        Triggered when a user closes site or 
        refreshes the page
        */
        
        // unscribe here or in removal task??
        redisClient.unsubscribe(socket.id); // unsubscribe from redis channel

        console.log("Calling manager worker to cancel user job upon disconnect..");

        celeryClient.call('tasks.removeUserJobsFromQueue', [socket.id]);

        return;

    });

    socket.on('error', function (err) {
        console.log("A socket error occured in cts_nodejs..");
        console.log(err);
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
        celeryClient.call('tasks.test_celery', [socket.id, 'hello celery'], function(result) {
            console.log(result);
            celeryClient.end();
        });

    });

});


function parseCTSRequestToCeleryWorkers(sessionid, data_obj, socket) {

    data_obj['sessionid'] = sessionid;  // add sessionid to data object
    var calc = data_obj['calc'];
    var jobObject = null;  // job object from calling celery worker (contains job id)

    if ('cancel' in data_obj) {
        // Can celery worker be canceled from here? (probably not)
        celeryClient.call('tasks.removeUserJobsFromQueue', [sessionid], null, {
            expires: new Date(Date.now() + celery_default_timeout)
        });
        // could send cancel notification to user..
        // console.log("Calling manager worker to cancel user job upon disconnect...");
        console.log("Sending cancel signal to 'cancel' channel");
        console.log("Data Object: ");
        console.log(data_obj);
        socket.emit('cancel', true);
        return;
    }

    if (data_obj['service'] == 'getSpeciationData') {
        console.log("calling chemaxon worker for speciation data..");
        jobObject = celeryClient.call('tasks.chemaxon_task', [data_obj], null, {
            expires: new Date(Date.now() + celery_default_timeout)
        });
    }
    else if (data_obj['service'] == 'getTransProducts') {
        console.log("calling metabolizer worker for transformation products");
        jobObject = celeryClient.call('tasks.metabolizer_task', [data_obj], null, {
            expires: new Date(Date.now() + celery_default_timeout)
        });
    }
    else if (data_obj['service'] == 'getChemInfo') {
        console.log("calling chem info worker..");
        jobObject = celeryClient.call('tasks.cheminfo_task', [data_obj], null, {
            expires: new Date(Date.now() + celery_default_timeout)
        });
    }
    else {
        handleCeleryPchemRequest(sessionid, data_obj, socket);
    }

    if (jobObject) {
        redisManager.rpush([sessionid, jobObject.taskid]);  // add job id to user's job list
    }
}


function handleCeleryPchemRequest(sessionid, data_obj, socket) {

    var jobObject = null;

    // Breaking user request up by calc, send to
    // the respective calc celery workers:
    for (var calc in data_obj['pchem_request']) {
        data_obj['calc'] = calc;
        if (calc == 'chemaxon') {
            console.log("sending request to chemaxon worker");
            jobObject = celeryClient.call('tasks.chemaxon_task', [data_obj], null, {
                expires: new Date(Date.now() + celery_default_timeout)
            });
        }
        else if (calc == 'sparc') {
            console.log("sending request to sparc worker");
            jobObject = celeryClient.call('tasks.sparc_task', [data_obj], null, {
                expires: new Date(Date.now() + celery_default_timeout)
            });
        }
        else if (calc == 'epi') {
            console.log("sending request to epi worker");
            jobObject = celeryClient.call('tasks.epi_task', [data_obj], null, {
                expires: new Date(Date.now() + celery_default_timeout)
            });
        }
        else if (calc == 'test') {
            console.log("sending request to test worker");
            jobObject = celeryClient.call('tasks.test_task', [data_obj], null, {
                expires: new Date(Date.now() + celery_default_timeout)
            });
        }
        else if (calc == 'measured') {
            console.log("sending request to measured worker");
            jobObject = celeryClient.call('tasks.measured_task', [data_obj], null, {
                expires: new Date(Date.now() + celery_default_timeout)
            });
        }

        if (jobObject) {
            redisManager.rpush([sessionid, jobObject.taskid]);  // add job id to user's job list
        }

    }

}