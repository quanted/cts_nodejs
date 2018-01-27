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

var chemaxon_kow_methods = ['KLOP', 'VG', 'PHYS'];

var redis_url = 'redis://' + config.redis.host + ':' + config.redis.port + '/0';  // uses env vars, or defaults to localhost

console.log("redis url " + redis_url)

var celery = require('node-celery'),
    client = celery.createClient({
        CELERY_BROKER_URL: redis_url,
        CELERY_RESULT_BACKEND: redis_url,
        CELERY_ROUTES: {
            'tasks.removeUserJobsFromQueue': {
                queue: 'manager_queue', 
            },
            'tasks.test_celery': {
                queue: 'manager_queue'
            },
            'tasks.cts_task': {
                queue: 'cts_queue'
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
        client.call('tasks.removeUserJobsFromQueue', [socket.id]);

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
        client.call('tasks.removeUserJobsFromQueue', [sessionid]);
        console.log("Calling manager worker to cancel user job upon disconnect...");
        return;
    }

    initiateRequestsParsing(data_obj);
}



function initiateRequestsParsing(request_post) {
    //Checks if request is single chemical or list of chemicals, then 
    //parses request up to fill worker queues w/ single chemical requests.
    //This was originally structured this way because revoking celery work
    //seems to only be successful for jobs not yet started.

    console.log("Request post coming into cts_task" + request_post);

    if (request_post['nodes'] && 'nodes' in request_post) {
        for (node_index in request_post['nodes']) {
            var node = request_post['nodes'][node_index];
            request_post['node'] = node;
            request_post['chemical'] = node['smiles'];
            request_post['mass'] = node['mass'];
            jobID = parseByService(request_post['sessionid'], request_post);
        }
    }
    else {
        jobID = parseByService(request_post['sessionid'], request_post);
    }

}


function parseByService(sessionid, request_post) {
    // Further parsing of user request.
    // Checks if 'service', if not it assumes p-chem request
    // TODO: at 'pchem' service instead of assuming..
    // Output: Returns nothing, pushes to redis (may not stay this way)

    request_post['sessionid'] = sessionid;

    if (request_post['service'] == 'getSpeciationData') {
        console.log("celery worker consuming chemaxon task");
        client.call('tasks.cts_task', [request_post]);
    }

    else if (request_post['service'] == 'getTransProducts'){
        console.log("celery worker consuming metabolizer task");
        client.call('tasks.cts_task', [request_post]);
    }

    else if (request_post['service'] == 'getChemInfo') {
        console.log("celery worker consuming cheminfo task");
        client.call('tasks.cts_task', [request_post]);
    }

    else {
        
        for (var calc in request_post['pchem_request']) {
            request_post['calc'] = calc;
            parsePchemRequestByCalc(sessionid, request_post);
        }
    }

    return;
}


function parsePchemRequestByCalc(sessionid, request_post) {
    // This function loops a user's p-chem request and parses
    // the work by calculator.
    // Output: Returns nothing, pushes to redis (may not stay this way, instead
    // the redis pushing may be handled at the task function level).

    var calc = request_post['calc'];
    var props = request_post['pchem_request'][calc];

    console.log("sessionid " + sessionid);
    console.log("request_post: " + JSON.stringify(request_post));
    console.log("calc: " + calc);
    console.log("props: " + props);

    if (calc == 'measured') {

        client.call('tasks.cts_task', [request_post]);
    }

    else if (calc == 'epi') {

        // epi_calc = EpiCalc()

        var epi_props_list = request_post.pchem_request.epi || [];  // confirm that this works (default to blank array if no 'epi')

        if ('water_sol' in epi_props_list || 'vapor_press' in epi_props_list) {
            request_post['prop'] = 'water_sol';  // trigger cts epi calc to get MP for epi request??
        }

        client.call('tasks.cts_task', [request_post]);

    }

    else {

        console.log("props: " + props);
        console.log("props length: " + props.length);

        for (var i = 0; i < props.length; i++) {

            var prop = props[i];
            request_post['prop'] = prop;

            var is_chemaxon = (calc == 'chemaxon');
            var is_kow = (prop == 'kow_no_ph' || prop == 'kow_wph');

            console.log("is chemaxon: " + is_chemaxon);
            console.log("is kow: " + is_kow);
            console.log("prop: " + prop);

            if (is_chemaxon && is_kow) {

                for (var j = 0; j < chemaxon_kow_methods.length; j++) {
                    // loop 3 chemaxon methods for KOW (todo: centralized config, not hardcoded methods here, which are already declared in cts_calcs)
                    request_post['method'] = chemaxon_kow_methods[j];
                    client.call('tasks.cts_task', [request_post]);
                }

            }

            else {

                if (calc == 'chemaxon') {
                    client.call('tasks.cts_task', [request_post]);
                }

                else if (calc == 'sparc') {
                    client.call('tasks.cts_task', [request_post]);
                }

                else if (calc == 'test') {
                    client.call('tasks.cts_task', [request_post]);
                }

            }
        }
    }

}