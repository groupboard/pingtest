// We make use of this 'server' variable to provide the address of the
// REST Janus API. By default, in this example we assume that Janus is
// co-located with the web server hosting the HTML pages but listening
// on a different port (8088, the default for HTTP in Janus), which is
// why we make use of the 'window.location.hostname' base address. Since
// Janus can also do HTTPS, and considering we don't really want to make
// use of HTTP for Janus if your demos are served on HTTPS, we also rely
// on the 'window.location.protocol' prefix to build the variable, in
// particular to also change the port used to contact Janus (8088 for
// HTTP and 8089 for HTTPS, if enabled).
// In case you place Janus behind an Apache frontend (as we did on the
// online demos at http://janus.conf.meetecho.com) you can just use a
// relative path for the variable, e.g.:
//
// 		var server = "/janus";
//
// which will take care of this on its own.
//
//
// If you want to use the WebSockets frontend to Janus, instead, you'll
// have to pass a different kind of address, e.g.:
//
// 		var server = "ws://" + window.location.hostname + ":8188";
//
// Of course this assumes that support for WebSockets has been built in
// when compiling the server. WebSockets support has not been tested
// as much as the REST API, so handle with care!
//
//
// If you have multiple options available, and want to let the library
// autodetect the best way to contact your server (or pool of servers),
// you can also pass an array of servers, e.g., to provide alternative
// means of access (e.g., try WebSockets first and, if that fails, fall
// back to plain HTTP) or just have failover servers:
//
//		var server = [
//			"ws://" + window.location.hostname + ":8188",
//			"/janus"
//		];
//
// This will tell the library to try connecting to each of the servers
// in the presented order. The first working server will be used for
// the whole session.
//
var server = null;
if(window.location.protocol === 'http:')
	server = "ws://" + window.location.hostname + "/janus_websocket";
else
	server = "wss://" + window.location.hostname + "/janus_websocket";

var janus = null;
var ping_times = {};
var total_ping_time = 0;
var total_jitter = 0;
var last_ping_time = 0;
var textroom = null;
var ping_to = null;
var ping_interval = 200;
var pings_sent = 0;
var pings_received = 0;
var opaqueId = "pingtest-"+Janus.randomString(12);

var myroom = new Date().getTime() % 10000000;
var myusername = Janus.randomString(12);
var myid = Janus.randomString(12);
var participants = {}
var transactions = {}

$(document).ready(function() {

    // Initialize the library (all console debuggers enabled)
    Janus.init({debug: "false", callback: function() {
        // Use a button to start the demo
        $('#start').one('click', function() {
            $(this).attr('disabled', true).unbind('click');
            // Make sure the browser supports WebRTC
            if(!Janus.isWebrtcSupported()) {
                bootbox.alert("No WebRTC support... ");
                return;
            }
            // Create session
            janus = new Janus(
            {
                iceServers: [ {urls: ['stun:stun.stunprotocol.org', 'stun:stun.l.google.com:19302']} ],
                server: server,
                success: function() {
                    // Attach to text room plugin
                    janus.attach(
                    {
                        plugin: "janus.plugin.textroom",
                        opaqueId: opaqueId,
                        success: function(pluginHandle) {
                            textroom = pluginHandle;
                            Janus.log("Plugin attached! (" + textroom.getPlugin() + ", id=" + textroom.getId() + ")");
                            // Setup the DataChannel
                            var body = { "request": "setup" };
                            Janus.debug("Sending message (" + JSON.stringify(body) + ")");
                            textroom.send({"message": body});
                            setup_ping();
                        },
                        error: function(error) {
                            console.error("  -- Error attaching plugin...", error);
                            bootbox.alert("Error attaching plugin... " + error);
                        },
                        webrtcState: function(on) {
                            Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
                            $("#videoleft").parent().unblock();
                        },
                        onmessage: function(msg, jsep) {
                            Janus.debug(" ::: Got a message :::");
                            Janus.debug(msg);
                            if(msg["error"] !== undefined && msg["error"] !== null) {
                                bootbox.alert(msg["error"]);
                            }
                            if(jsep !== undefined && jsep !== null) {
                                // Answer
                                textroom.createAnswer(
                                {
                                    jsep: jsep,
                                    media: { audio: false, video: false, data: true },	// We only use datachannels
                                    success: function(jsep) {
                                        Janus.debug("Got SDP!");
                                        Janus.debug(jsep);
                                        var body = { "request": "ack" };
                                        textroom.send({"message": body, "jsep": jsep});
                                    },
                                    error: function(error) {
                                        Janus.error("WebRTC error:", error);
                                        bootbox.alert("WebRTC error... " + JSON.stringify(error));
                                    }
                                });
                            }
                        },
                        ondataopen: function(data) {
                            Janus.log("The DataChannel is available!");
                            // Prompt for a display name to join the default room
                            $('#roomjoin').removeClass('hide').show();
                            $('#registernow').removeClass('hide').show();
                            $('#register').click(registerUsername);
                            $('#username').focus();
                            //registerUsername();
                            var m = { "request": "exists", "room": myroom };
                            textroom.send({"message": m, "success": reply_exists});
                        },
                        ondata: function(data) {
                            Janus.debug("We got data from the DataChannel! " + data);
                            //~ $('#datarecv').val(data);
                            var json = JSON.parse(data);
                            var transaction = json["transaction"];
                            if(transactions[transaction]) {
                                // Someone was waiting for this
                                transactions[transaction](json);
                                delete transactions[transaction];
                                return;
                            }
                            var what = json["textroom"];
                            if(what === "message") {
                                var msg = json["text"];
                                received_ping(msg);

                            } else if(what === "join") {
                                    // Somebody joined
                                    var username = json["username"];
                                    var display = json["display"];
                                    participants[username] = display ? display : username;
                            } else if(what === "leave") {
                                    // Somebody left
                                    var username = json["username"];
                                    var when = new Date();
                                    delete participants[username];
                            } else if(what === "kicked") {
                                    // Somebody was kicked
                                    var username = json["username"];
                                    var when = new Date();
                                    delete participants[username];
                                    if(username === myid) {
                                            bootbox.alert("You have been kicked from the room", function() {
                                                    window.location.reload();
                                            });
                                    }
                            } else if(what === "destroyed") {
                                    if(json["room"] !== myroom)
                                            return;
                                    // Room was destroyed, goodbye!
                                    Janus.warn("The room has been destroyed!");
                                    bootbox.alert("The room has been destroyed", function() {
                                            window.location.reload();
                                    });
                            }
                        },
                        oncleanup: function() {
                                Janus.log(" ::: Got a cleanup notification :::");
                                $('#datasend').attr('disabled', true);
                        }
                    });
                },
                error: function(error) {
                    Janus.error(error);
                    bootbox.alert(error, function() {
                            window.location.reload();
                    });
                },
                destroyed: function() {
                    window.location.reload();
                }
            });
        });
    }});
});

function received_ping(msg)
{
    ++pings_received;
    var t1 = ping_times[msg];
    if (t1)
    {
        var t2 = performance.now();
        if (0 != last_ping_time)
        {
            total_jitter += Math.abs(last_ping_time-(t2-t1));
            var avg_jitter = total_jitter/(pings_received-1);
            $('#average_jitter').html(avg_jitter.toFixed(0));
        }
        last_ping_time = t2-t1;
        total_ping_time += last_ping_time;

    }
    var avg = total_ping_time/pings_received;
    $('#chatroom').append("<p>Sent: "+pings_sent);
    $('#chatroom').append("<p>Received: "+pings_received);
    var packet_loss = (pings_sent-pings_received)/pings_sent*100;
    $('#pings_sent').html(pings_sent);
    $('#average_ping_time').html(avg.toFixed(0));
    $('#pings_received').html(pings_received);
    $('#packet_loss').html(packet_loss.toFixed(0));
}

function reply_exists(msg)
{
    if (typeof(msg["exists"]) != 'undefined')
    {
        var exists = msg["exists"];
        if (exists)
        {
            registerUsername();
            start_ping();
        }
        else
        {
            var msg = { "request": "create", "room": myroom };
            textroom.send({"message": msg, "success": reply_create});
        }
    }
}

function reply_create(msg)
{
    registerUsername();
    start_ping();
}

function setup_ping()
{
    $('#start').removeAttr('disabled').html("Stop").unbind('click')
        .click(function() {
            if (null != ping_to)
            {
                clearInterval(ping_to);
                ping_to = null;
            }
            //$(this).attr('disabled', true);
            //janus.destroy();
            $('#start').html("Start").unbind('click')
                .click(function() {
                    $('#start').html("Start")
                    setup_ping();
                    start_ping();
                });
        });
}

function start_ping()
{
    total_ping_time = 0;
    pings_sent = 0;
    pings_received = 0;
    total_jitter = 0;
    last_ping_time = 0;
    ping_times = {};
    ping_to = setInterval(send_ping, ping_interval);
}

function send_ping()
{
    var message = {
            textroom: "message",
            transaction: randomString(12),
            ack: false,
            room: myroom,
            text: ""+pings_sent,
    };
    ping_times[pings_sent] = performance.now();
    ++pings_sent;
    textroom.data({
            text: JSON.stringify(message),
            error: function(reason) { bootbox.alert(reason); },
            success: function() { $('#datasend').val(''); }
    });
}

function checkEnter(field, event) {
	var theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
	if(theCode == 13) {
		if(field.id == 'username')
			registerUsername();
		else if(field.id == 'datasend')
			sendData();
		return false;
	} else {
		return true;
	}
}

function registerUsername() {
    // Try a registration
    var transaction = randomString(12);
    var register = {
            textroom: "join",
            transaction: transaction,
            room: myroom,
            username: myid,
            display: myusername
    };
    transactions[transaction] = function(response) {
            if(response["textroom"] === "error") {
                    // Something went wrong
                    if(response["error_code"] === 417) {
                            // This is a "no such room" error: give a more meaningful description
                            bootbox.alert(
                                    "<p>Apparently room <code>" + myroom + "</code> (the one this demo uses as a test room) " +
                                    "does not exist...</p><p>Do you have an updated <code>janus.plugin.textroom.cfg</code> " +
                                    "configuration file? If not, make sure you copy the details of room <code>" + myroom + "</code> " +
                                    "from that sample in your current configuration file, then restart Janus and try again."
                            );
                    } else {
                            bootbox.alert(response["error"]);
                    }
                    $('#username').removeAttr('disabled').val("");
                    $('#register').removeAttr('disabled').click(registerUsername);
                    return;
            }
            // We're in
            $('#roomjoin').hide();
            $('#room').removeClass('hide').show();
            $('#participant').removeClass('hide').html(myusername).show();
            $('#chatroom').css('height', ($(window).height()-420)+"px");
            $('#datasend').removeAttr('disabled');
            // Any participants already in?
            if(response.participants && response.participants.length > 0) {
                    for(var i in response.participants) {
                            var p = response.participants[i];
                            participants[p.username] = p.display ? p.display : p.username;
                            if(p.username !== myid && $('#rp' + p.username).length === 0) {
                                    // Add to the participants list
                                    $('#list').append('<li id="rp' + p.username + '" class="list-group-item">' + participants[p.username] + '</li>');
                                    $('#rp' + p.username).css('cursor', 'pointer').click(function() {
                                            var username = $(this).attr('id').split("rp")[1];
                                            sendPrivateMsg(username);
                                    });
                            }
                            $('#chatroom').append('<p style="color: green;">[' + getDateString() + '] <i>' + participants[p.username] + ' joined</i></p>');
                            $('#chatroom').get(0).scrollTop = $('#chatroom').get(0).scrollHeight;
                    }
            }
    };
    textroom.data({
            text: JSON.stringify(register),
            error: function(reason) {
                    bootbox.alert(reason);
                    $('#username').removeAttr('disabled').val("");
                    $('#register').removeAttr('disabled').click(registerUsername);
            }
    });
}

function sendPrivateMsg(username) {
	var display = participants[username];
	if(!display)
		return;
	bootbox.prompt("Private message to " + display, function(result) {
		if(result && result !== "") {
			var message = {
				textroom: "message",
				transaction: randomString(12),
				room: myroom,
				to: username,
				text: result
			};
			textroom.data({
				text: JSON.stringify(message),
				error: function(reason) { bootbox.alert(reason); },
				success: function() {
					$('#chatroom').append('<p style="color: purple;">[' + getDateString() + '] <b>[whisper to ' + display + ']</b> ' + result);
					$('#chatroom').get(0).scrollTop = $('#chatroom').get(0).scrollHeight;
				}
			});
		}
	});
	return;
}

function sendData() {
	var data = $('#datasend').val();
	if(data === "") {
		bootbox.alert('Insert a message to send on the DataChannel');
		return;
	}
	var message = {
		textroom: "message",
		transaction: randomString(12),
		room: myroom,
 		text: data,
	};
	// Note: messages are always acknowledged by default. This means that you'll
	// always receive a confirmation back that the message has been received by the
	// server and forwarded to the recipients. If you do not want this to happen,
	// just add an ack:false property to the message above, and server won't send
	// you a response (meaning you just have to hope it succeeded).
	textroom.data({
		text: JSON.stringify(message),
		error: function(reason) { bootbox.alert(reason); },
		success: function() { $('#datasend').val(''); }
	});
}

// Helper to format times
function getDateString(jsonDate) {
	var when = new Date();
	if(jsonDate) {
		when = new Date(Date.parse(jsonDate));
	}
	var dateString =
			("0" + when.getUTCHours()).slice(-2) + ":" +
			("0" + when.getUTCMinutes()).slice(-2) + ":" +
			("0" + when.getUTCSeconds()).slice(-2);
	return dateString;
}

// Just an helper to generate random usernames
function randomString(len, charSet) {
    charSet = charSet || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var randomString = '';
    for (var i = 0; i < len; i++) {
    	var randomPoz = Math.floor(Math.random() * charSet.length);
    	randomString += charSet.substring(randomPoz,randomPoz+1);
    }
    return randomString;
}
