var Janus = require('./node_modules/janus-gateway-js');

var janus = new Janus.Client('ws://localhost:8188', {
  token: 'token',
  apisecret: 'apisecret',
  keepalive: 'true'
});
 
var plugin = null;
var num_tx = 0;
var num_rx = 0;
var all_sent = false;
var plugin_name;

janus.createConnection('id').then(function(connection) {
  connection.createSession().then(function(session) {
    session.attachPlugin('janus.plugin.textroom').then(function(pl) {
      plugin_name = 'textroom';
      plugin = pl;
      plugin.send({'janus':'message', 'body':{ 'request':'list'} }).then(function(response){});
      plugin.on('message', reply_list);
    });
  });
});

function reply_list(reply)
{
    var pl = reply._plainMessage;
    if (pl.janus === 'success')
    {
        var msg = pl.plugindata.data;
        if (msg[plugin_name] === 'success')
        {
            var rooms = msg.list;
            for (var i = 0; i < rooms.length; i++)
            {
                var r = rooms[i];
                if (r.num_participants === 0 && r.room !== 1234)
                {
                    var m = { "request": "destroy", "room": r.room };
                    plugin.send({"janus":"message", 'body':m});
                    ++num_tx;
                    //console.log("destroying room "+r.room);
                }
            }

            all_sent = true;
            if (num_tx == 0)
            {
                process.exit(-1);
            }
        }
        else if (msg[plugin_name] === 'destroyed')
        {
            ++num_rx;
            //console.log("destroyed room "+msg['room']);
            if (all_sent && num_tx == num_rx)
            {
                process.exit(-1);
            }
        }
    }
}

