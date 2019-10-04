const express = require("express");
var app = express();
const mappings = require('../../src/mappings.js');
let config = require(mappings.config);
const { readFileSync } = require("fs");
const cookieParser = require("cookie-parser");
const fetch = require("node-fetch");

app.use(cookieParser());
app.set("views", global.viewsDir);
app.set('view engine', 'ejs');

const base = "https://censorbot.jt3ch.net/dash/v3";

// function loadAll() {
//     pages.index = readFileSync(__dirname + "/index.html", "utf-8");
//     pages.server = readFileSync(__dirname + "/server.html", "utf-8");
// }

// loadAll();

/*
    global BigInt
    global RR
    global manager
*/

app.get("/test", (req, res) => {
    res.clearCookie("a");
    res.send("a");
})

function checkShard(guildID, shardamount) {
    guildID = String(guildID);
    var shard;
    for (var i = 0; i < shardamount; i++) {
        if ((BigInt(guildID) >> BigInt(22)) % BigInt(shardamount) == i) { shard = i; break; }
    }
    return shard;
}



app.get("/", async(req, res) => {
    let guilds = await global.getUser(req.cookies.token, res);
    if (!guilds) return;
    res.render("guilds", { guilds: guilds, token: req.cookies.token, base: base });
})

app.get("/token", (req, res) =>{
    res.json({token: req.cookies.token})
})

app.get("/.json", async(req, res) => {
    let guilds = await global.getUser(req.cookies.token, res);
    if (!guilds) return;
    res.json(guilds);
})

app.get("/error/:error", (req, res) => {
    res.render("errors/" + req.params.error, {base: base, ...req.query});
})
app.get("/invite", (req, res) => {
    res.render("invite", {id: "123"});
})

app.get("/login", (req, res) => {
    if (!req.query.token) return res.send("Error occured whilst setting token");
    res.cookie("token", req.query.token);
    res.redirect(base + (req.query.s ? "/"+req.query.s : ""));
})

app.get("/logout", (req, res) => {
    res.clearCookie("token")
    res.send("Logged out");
})

app.get("/reload", (req, res) => {
    if (req.query.a !== config.auth) return res.send("no");
    loadAll();
    res.send(":ok_hand:")
})


app.use("/:serverid", async(req, res, next) => {
    var guilds = await global.getUser(req.cookies.token, res);
    if (!guilds) return;
    
    let id = req.params.serverid.split(".")[0];
    var g = guilds.find(x => x.i == id);
    if (!g) {
        var user = await global.db.dashdb.find({ token: req.cookies.token });
        var isa = await global.isAdmin(user.id);
        if(!isa) return res.render("servererror", {base: base});
        console.log("Admin login");
        g = {
            i: req.params.serverid,
            n: true
        }
    }
    req.shard = checkShard(String(id), config.shardCount);
    req.partialGuild = g;
    next();
})

app.get("/:serverid", async(req, res) => {
    var serverid = req.params.serverid;
    let type;
    if(serverid.includes(".")) {
        let split = serverid.split(".");
        serverid = split[0];
        type = split[1];
    }
    let stuff = await manager.shards.get(req.shard).eval(`
        function getStuff(client) {
            var guild = client.guilds.get("${serverid}");
            if(!guild) return false;
            let obj = {
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
            if(${req.partialGuild.n === true ? "true" : "false"}) obj.n = guild.name;
            return obj;
        }
        getStuff(this);
    `)
    if(!stuff) return res.render("invite", {id: serverid});
    let db = await global.db.rdb.getAll(serverid);
    if(!db) return res.send("Error occured while communicating with your server");
    delete db["_id"];
    if(stuff.n) {
        req.partialGuild.n = stuff.n;
        delete stuff.n;
    }
    var obj = {
        id: req.partialGuild.i,
        name: req.partialGuild.n,
        ...stuff,
        db: db
    };
    if(type == "json") return res.json(obj);
    res.render("guild", { data: obj, base: base, token: req.cookies.token });
})

module.exports = app;