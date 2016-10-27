# CTS_NODEJS 

A bridge between CTS Frontend and the (django) CTS backend. Passes
users data requests to CTS backend, then pushes data respones 
to client via web sockets and redis pub/sub.


# Requirements:
nodejs v0.12.2
npm


# Install:
cd into cts_nodejs directory, then type:
	
	npm install 

to download dependencies from package.json


# Deploy:
Run the following command in the cts_nodejs directory:

	node node_server.js


# Test:

	node node_test.js

Then visit http://localhost:3000 for test page.