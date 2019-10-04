const express = require("express");
var app = express();
const mappings = require("../../src/mappings.js");
delete require.cache[require.resolve(mappings.config)];
var config = require(mappings.config);
const flake = require('simpleflake');
const crypto = require('crypto');
let client = { db: global.db };
const fetch = require("node-fetch");

const baseURL = "https://censorbot.jt3ch.net";
const redirectURL = "https://api.jt3ch.net/censorbot/v3/auth/callback";

global.viewsDir = require("path").resolve(__dirname, "../", "website/pages")

app.set("views", global.viewsDir);
app.set('view engine', 'ejs');

var bit = 0x0000008
/*
    global RR
    global manager
    global BigInt
*/

function checkShard(guildID, shardamount) {
    guildID = String(guildID);
    var shard;
    for (var i = 0; i < shardamount; i++) {
        if ((BigInt(guildID) >> BigInt(22)) % BigInt(shardamount) == i) { shard = i; break; }
    }
    return shard;
}
let getuser = async(tok) => {
    let e = await fetch("https://discordapp.com/api/users/@me", {
        method: "GET",
        headers: {
            Authorization: `Bearer ${tok}`,
        }
    })
    return await e.json();
}

global.isAdmin = async (userid) => {
    var r = await fetch("https://api.jt3ch.net/censorbot/admin/" + userid);    
    return await r.json();
}

function encodeJSON(element, key, list) {
    var list = list || [];
    if (typeof(element) == 'object') {
        for (var idx in element)
            encodeJSON(element[idx], key ? key + '[' + idx + ']' : idx, list);
    }
    else {
        list.push(key + '=' + encodeURIComponent(element));
    }
    return list.join('&');
}

async function getToken(code, refresh = false) {
    var f = await fetch("https://discordapp.com/api/v6/oauth2/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body:
            encodeJSON(
                {
                    client_id: config.oauth.id,
                    client_secret: config.oauth.secret,
                    code: refresh ? undefined : code,
                    refresh_token: refresh ? code : undefined,
                    grant_type: refresh ? "refresh_token" : "authorization_code",
                    redirect_uri: redirectURL,
                    scope: "identify guilds"
                }    
            )
    })
    return await f.json();
}


app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    console.log(req.method + " " + req.url);
    next();
});

app.get("/", (req, res) => { res.json({hello: "world"}) })

app.get("/auth", (req, res) => {
    let obj = {
                    client_id: config.oauth.id,
                    redirect_uri: redirectURL,
                    response_type: "code",
                    scope: "identify guilds"
                }    
    if(req.query.s) obj.state = req.query.s
    res.redirect(
        "https://discordapp.com/api/oauth2/authorize?"
            + encodeJSON(
               obj
            )
    )
})

app.get("/test/:token", (req, res) => {
    getToken(req.params.token, true).then(x=>{
        res.json(x);
    })
})

async function doToken(resp, res) {
    var user = await getuser(resp.access_token);
    if(!user || user.error) {
        res.send("Error occured while finding your account");
        return false;
    }
    var dashUser = await client.db.dashdb.getAll(user.id);
    if(dashUser) {
        if(dashUser.bearer !== resp.access_token || dashUser.refresh !== resp.refresh_token) 
            await client.db.dashdb.update(user.id, {
                bearer: resp.access_token, 
                refresh: resp.refresh_token, 
                expires: new Date(new Date().getTime() + resp.expires_in)
            });
        return dashUser.token;
    }
    let newToken = crypto.createHash('sha256').update(flake(new Date())).update(config.oauth.mysecret).digest('hex');
    
    await client.db.dashdb.create(user.id, {
        token: newToken,
        bearer: resp.access_token,
        expires: new Date(new Date() + resp.expires_in),
        refresh: resp.refresh_token
    });
    return newToken;
}

app.get("/auth/callback", async (req, res) => {
    if(req.query["error"]) return res.render("errors/auth", {error: req.query.error, s: req.query.state ? "?s=" + req.query.state : ""});
    if(!req.query.code) return res.send("Error, no code provided");
    var resp = await getToken(req.query.code);
    if(resp.error) return res.send("An error occured while authenticating you!");
    
    var token = await doToken(resp, res);
    if(!token) return;
    
    res.redirect(baseURL + "/dash/v3/login?token=" + token + (req.query.state ? "&s="+req.query.state : ""));
})

delete require.cache[require.resolve("../website/router.js")];
var website = require("../website/router.js");
app.use("/website", website);


const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));

global.userCache = new Map();
global.clientRequest = (endpoint, method, body, token, cb) => {
    fetch("https://discordapp.com/api/v6" + endpoint, {
            method: method || "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: body ? JSON.stringify(body) : null
        })
        .then(x => x.json())
        .then(res => cb(res));
}

global.getGuilds = (token) => {
    return new Promise(res => {
        global.clientRequest("/users/@me/guilds", "GET", null, token, (response) => {
            if (response.code == 0) return res(false);
            res(response.filter(x => ((x.permissions & bit) != 0 || x.owner)).map(x => { return { n: x.name, i: x.id, a: x.icon } }));
        })
    })
}

global.goToLogin = (res, serverid) => { res.redirect(`https://api.jt3ch.net/censorbot/v3/auth${serverid ? "?s="+serverid : ""}`); }
global.getUser = async(token, res) => {
    if (!token) { global.goToLogin(res, res.req.params.serverid); return false };
    let cache = global.userCache.get(token);
    if (cache) return cache;
    var user = await global.db.dashdb.find({ token: token });
    if (!user) {
        res.clearCookie("token");
        global.goToLogin(res);
        return false;
    }
    let bearer;
    if(new Date() > user.expires.getTime()) {
        var dUser = await getToken(user.refresh, true);
        if(!dUser) { global.goToLogin(res, res.req.params.serverid); return false }
        await doToken(dUser, res);
        bearer = dUser.access_token;
    } else bearer = user.bearer;
    var guilds = await global.getGuilds(bearer);
    if (!guilds) {
        global.goToLogin(res, res.req.params.serverid);
        return false;
    }
    global.userCache.set(token, guilds);
    setTimeout(() => { global.userCache.delete(token) }, 300000);

    return guilds;
}

async function backendGuild(token, res) {
    if (!token) { 
        res.status(403);
        res.json({error: "unauthorized"});
        return false;
    };
    let cache = global.userCache.get(token);
    if (cache) return cache;
    var user = await global.db.dashdb.find({ token: token });
    if (!user) {
        res.status(403);
        res.json({error: "unauthorized"});
        return false;
    }
    var guilds = await global.getGuilds(user.bearer);
    if (!guilds) {
        res.status(403);
        res.json({error: "unauthorized"});
        return false;
    }

    global.userCache.set(token, guilds);
    setTimeout(() => { global.userCache.delete(token) }, 300000);

    return guilds;
} 

global.refreshLimit = new Map();

app.post("/refresh", (req, res) => {
    if(!req.headers.authorization) return res.json({error: "No authorization"});
    if(global.refreshLimit.has(req.headers.authorization)) return res.json({error: "You can only refresh every 5 minutes!"});
    global.refreshLimit.set(req.headers.authorization, setTimeout(()=>{ global.refreshLimit.delete(req.headers.authorization) }, 300000));
    global.userCache.delete(req.headers.authorization);
    res.json({success: true});
})

function checkValidity(obj, guild) {
    if(typeof obj.base !== "boolean") return 1;
    if(typeof obj.censor.msg !== "boolean") return 2;
    if(typeof obj.censor.emsg !== "boolean") return 3;
    if(typeof obj.censor.nick !== "boolean") return 4;
    if(typeof obj.censor.react !== "boolean") return 5;
    if(typeof obj.antighostping !== "boolean") return 6;
    if(typeof obj.log !== "string" || !guild.c.some(x=>x.id === obj.log)) return 7;
    if((typeof obj.role !== "string" && obj.role !== null) || (typeof obj.role == "string" && !guild.r.some(x=>x.id == obj.role))) return 8;
    if(!(obj.filter instanceof Array)) return 9;
    if(obj.filter.some(x=>x.match(/[^a-zA-Z0-9 ]/gi))) return 10;
    if(obj.pop_delete !== null && typeof obj.pop_delete !== "number") return 11;
    if(typeof obj.pop_delete == "number" && obj.pop_delete > 120 * 1000) return 12;
    if(typeof obj.punishment.on !== "boolean") return 13;
    if(typeof obj.punishment.amount !== "number" || obj.punishment.amount < 1) return 14;
    if((typeof obj.punishment.role !== "string" && obj.punishment.role !== null) || (typeof obj.punishment.role == "string" && !guild.r.some(x=>x.id == obj.punishment.role))) return 15;
    
    
    return true;
}

app.get("/guilds", (req, res) => {
    if(req.query.a !== config.auth) return res.send("err");
    res.json([...global.userCache.values()]);
})

app.post("/guilds/:serverid/settings", async (req, res) => {
    let guilds = await backendGuild(req.headers.authorization, res);
    if(!guilds) return;
    var guild = guilds.find(x=>x.i == req.params.serverid);
    if(!guild) {
        var user = await global.db.dashdb.find({ token: req.headers.authorization });
        var isa = await global.isAdmin(user.id);
        if(!isa) return res.json({error: "unauthorized"});
        console.log("Admin login");
        guild = {i: req.params.serverid}
    }
    let stuff = await manager.shards.get(checkShard(req.params.serverid, config.shardCount)).eval(`
        function getStuff(client) {
            var guild = client.guilds.get("${guild.i}");
            if(!guild) return false;
            return {
                c: guild.channels
                    .filter(x=>!x.deleted && x.type == "text")
                    .map(x=>{
                        return {
                            id: x.id, 
                            name: x.name
                        }
                    }),
                r: guild.roles
                    .filter(x=>!x.managed && x.name != "@everyone")
                    .map(x=>{
                        return {
                            id: x.id,
                            name: x.name
                        }
                    })
            }
        }
        getStuff(this);
    `)
    var check = checkValidity(req.body || {}, stuff)
    if(check !== true) return res.json({error: "invalid object", place: check});
    
    var o = req.body;
    global.db.rdb.update(req.params.serverid, {
        base: o.base,
        censor: {
            msg: o.censor.msg,
            emsg: o.censor.emsg,
            nick: o.censor.nick,
            react: o.censor.react,
        },
        log: o.log,
        role: o.role,
        filter: o.filter,
        antighostping: o.antighostping,
        pop_delete: o.pop_delete,
        msg: o.msg,
        punishment: {
            on: o.punishment.on,
            amount: o.punishment.amount,
            role: o.punishment.role
        }
    }) 
    .then(x=>{
        if(!x || x.n < 1) return res.json({error: "db error"});
        res.json(true);
    })
    .catch(err=>{
        res.json({error: err});
    })
})

app.get("/guilds/:serverid/settings", async (req, res) => {
    let guilds = await backendGuild(req.headers.authorization, res);
    if(!guilds) return;
    var guild = guilds.find(x=>x.i == req.params.serverid);
    if(!guild) res.json({ error: "unauthorized" });
    let gdb = await client.db.rdb.getAll(guild.i);
    if(!gdb) return res.json({error: "invalid_guild"});
    delete gdb["_id"];
    
    res.json(gdb);
})

// app.get("*", (req,res) => {
//     res.status(403);
//     res.json({
//         error: "WIP"
//     })
// })

module.exports = app;