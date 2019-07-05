require('dotenv').config();

const http = require("http");
const express = require('express');
const Discord = require('discord.js');
const fs = require('fs');
const read = require('fs-readdir-recursive');
const path = require('path');

const auth = require('./src/auth');
const icons = require('./config/icons.json');

var web = express();
web.set("views", __dirname);
web.use(require('express-useragent').express());
web.use(require('cookie-parser')());
web.use(require('body-parser').json());
web.use(require('body-parser').urlencoded({
  extended: false
}));
const bot = new Discord.Client();
const db = require('better-sqlite3')('data/db.db');

function boot() {
  db.prepare("CREATE TABLE if not exists logindata (userid TEXT PRIMARY KEY, sessionkey TEXT, authkey TEXT);").run();
  web.listen(process.env.PORT);
  bot.login(process.env.DISCORD_TOKEN);
}

web.all('*', async (req, res) => {
  if (fs.existsSync(path.join(__dirname, "/config/disable"))) {
    res.sendFile(path.join(__dirname, "/www/html/maintenance.html"));
    return;
  }

  var browser = req.useragent.browser;
  if (browser != "Chrome" && browser != "Firefox") {
    res.sendFile(path.join(__dirname, "/www/html/browserunsup.html"));
    return;
  }

  var {
    authUserID,
    authSession
  } = auth.getCookies(req);
  var authToken = auth.getToken(authUserID, db);
  var authUserData = auth.sessionValid(authUserID, authSession, db) ? await auth.getUserData(authToken) : undefined;
  var user = await getUser(authUserID);

  if (req.path.endsWith(".js") || req.path.endsWith(".css") || req.path.endsWith(".ico") || req.path.endsWith(".html")) {
    res.sendFile(path.join(__dirname, req.path));
  } else if (fs.existsSync(path.join(__dirname, "/src/requests/", req.path + ".js"))) {
    eval(bin2String(fs.readFileSync(path.join(__dirname, "/src/requests/", req.path + ".js"))));
  } else {
    if (!auth.sessionValid(authUserID, authSession, db)) {
      res.sendFile(path.join(__dirname, "/www/html/login.html"));
      return;
    }

    if (!user) {
      res.sendFile(path.join(__dirname, "/www/html/unknownuser.html"));
      return;
    }

    if (!getConfigurableGuilds(user).map(g => g.id).includes(req.query.guild)) {
      res.render("www/html/guildpicker.ejs", {
        user: user,
        configurableGuilds: getConfigurableGuilds(user),
      });
      return;
    }

    var categories = initializeCategoriesRecursively("./blocks/");
    var {
      blocks,
      max,
      restrictions,
      generators
    } = initializeBlocksRecursively("./blocks/", categories);

    res.render("www/html/dlockly.ejs", {
      blocks: blocks,
      max: JSON.stringify(max),
      categories: categories,
      restrictions: JSON.stringify(restrictions),
      xmlCategoryTree: generateXmlTreeRecursively(categories),
      generators: generators,
      blocklyXml: getBlocklyXml(req.query.guild),
      exampleXml: getExampleXml()
    });
  }
});

function getBlocklyXml(id) {
  if (!fs.existsSync(path.join(__dirname, "/data"))) {
    fs.mkdirSync(path.join(__dirname + "/data"));
  }
  if (!fs.existsSync(path.join(__dirname, "/data/", id))) {
    fs.mkdirSync(path.join(__dirname, "/data/", id));
  }
  if (!fs.existsSync(path.join(__dirname, "/data/", id, "/blockly.xml"))) {
    return '';
  }
  return fs.readFileSync(path.join(__dirname, "/data/", id, "/blockly.xml"));
}

function getExampleXml() {
  return fs.readFileSync(path.join(__dirname, "/config/example.xml"));
}

async function getUser(id) {
  return (await getUsers())[id];
}

async function getUsers() {
  var guilds = bot.guilds.array();
  var result = {};

  for (var guild of guilds) {
    var _guild = await bot.guilds.get(guild.id).fetchMembers();

    _guild.members.forEach((v, k) => result[k] = v);
  }

  return result;
}

function getConfigurableGuilds(_member) {
  var guilds = bot.guilds.array();
  var user = _member.user;
  var goodGuilds = [];
  for (var guild of guilds) {
    var member = guild.member(user);
    if (!member) continue;
    if (member.hasPermission('MANAGE_GUILD')) goodGuilds.push(guild);
  }
  return goodGuilds;
}

function generateXmlTreeRecursively(categories) {
  var result = "";
  for (var c of categories) {
    result += "<category name='" + c.name.replace(/_/g, "") + "' colour='" + c.color + "'>";
    result += generateXmlTreeRecursively(c.subcategories);
    for (var b of c.blocks) {
      result += "<block type='" + b + "'></block>";
    }
    result += "</category>"
  }
  return result;
}

function initializeBlocksRecursively(p, categories) {
  var blocks = [];
  var max = {};
  var restrictions = {};
  var generators = [];

  var files = read(p).filter(f => f.endsWith(".json"));

  for (var f of files) {
    if (f.startsWith("/") || f.startsWith("\\")) f = f.substring(1);
    if (f.endsWith("/") || f.endsWith("\\")) f.substr(0, f.length - 1);

    var json = JSON.parse(fs.readFileSync(path.join("./blocks/", f)));
    var splits = f.split(/[\/\\]+/g);
    splits.pop();

    if (json.icons) {
      var _icons = json.icons.reverse();
      for (var icon of _icons) {
        if (!json.block.args0) json.block.args0 = [];

        json.block.args0.unshift({
          "type": "field_image",
          "src": icons[icon],
          "width": 15,
          "height": 15,
          "alt": icon,
          "flipRtl": false
        });

        json.block.message0 = bumpMessageNumbers(json.block.message0);
      }
    }

    blocks.push(json.block);

    if (json.max) max[json.block.type] = json.max;

    if (json.restrictions) restrictions[json.block.type] = json.restrictions;

    var desiredCategoryName = splits.pop();
    var desiredCategory = findCategoryRecursively(categories, desiredCategoryName);

    if (desiredCategory) desiredCategory.blocks.push(json.block.type);

    if (json.generator) {
      generators.push({
        type: json.block.type,
        generator: json.generator
      });
    }
  }

  return {
    blocks: blocks,
    max: max,
    restrictions: restrictions,
    generators: generators
  };
}

function findCategoryRecursively(categories, cat) {
  for (var c of categories) {
    if (c.name == cat) return c;

    var subcat = findCategoryRecursively(c.subcategories, cat);
    if (subcat) return subcat;
  }
}

function initializeCategoriesRecursively(p) {
  var isDirectory = source => fs.lstatSync(source).isDirectory();
  var dirs = fs.readdirSync(p).map(name => path.join(p, name)).filter(isDirectory);

  var result = [];
  for (var dir of dirs) {
    result.push({
      name: dir.split(/[\/\\]+/g).pop(),
      color: Number.parseInt(fs.readFileSync(path.join(dir, "/.color"))),
      subcategories: initializeCategoriesRecursively(dir),
      blocks: [],
    });
  }

  return result;
}

function bumpMessageNumbers(message) {
  var str = "%0 " + message;
  var nr = str.match(/%\d+/g).length;

  for (var i = nr - 1; i >= 0; i--) {
    str = str.replace("%" + i, "%" + Number.parseInt(i + 1));
  }

  return str;
}

function bin2String(array) {
  if (typeof array == typeof "str") return array;
  return String.fromCharCode.apply(String, array);
}

setInterval(() => {
  http.get(`http://${process.env.PROJECT_DOMAIN}.glitch.me/`);
}, 280000);

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: ', p, 'reason:', reason);
});

bot.on('error', (e) => {
  console.error(e);
})

bot.on('warn', (w) => {
  console.warn(w);
});

var events = {
  "channelCreate": {
    "parameters": ["channel"],
    "check": "channel.guild",
    "guildGetter": "channel.guild"
  },
  "channelDelete": {
    "parameters": ["channel"],
    "check": "channel.guild",
    "guildGetter": "channel.guild"
  },
  "emojiCreate": {
    "parameters": ["emoji"],
    "check": "emoji.guild",
    "guildGetter": "emoji.guild"
  },
  "emojiDelete": {
    "parameters": ["emoji"],
    "check": "emoji.guild",
    "guildGetter": "emoji.guild"
  },
  "guildBanAdd": {
    "parameters": ["guild", "user"],
    "check": "guild",
    "guildGetter": "guild"
  },
  "guildBanRemove": {
    "parameters": ["guild", "user"],
    "check": "guild",
    "guildGetter": "guild"
  },
  "guildMemberAdd": {
    "parameters": ["member"],
    "check": "member.guild",
    "guildGetter": "member.guild"
  },
  "guildMemberRemove": {
    "parameters": ["member"],
    "check": "member.guild",
    "guildGetter": "member.guild"
  },
  "message": {
    "parameters": ["message"],
    "check": "message.guild && !message.author.bot",
    "guildGetter": "message.guild"
  },
  "messageDelete": {
    "parameters": ["message"],
    "check": "message.guild",
    "guildGetter": "message.guild"
  },
  "roleCreate": {
    "parameters": ["role"],
    "check": "role.guild",
    "guildGetter": "role.guild"
  },
  "roleDelete": {
    "parameters": ["role"],
    "check": "role.guild",
    "guildGetter": "role.guild"
  }
}

bot.on("ready", () => {
  bot.user.setActivity("with blocks. https://dlockly.glitch.me");

  for (var event in events) {
    if (events.hasOwnProperty(event)) {
      var parameters = events[event].parameters;
      var check = events[event].check;
      var guild = events[event].guildGetter;

      try {
        eval(`bot.on('${event}', (${parameters.join(",")}) => {
              if (!(${check})) return;
              var guild = ${guild};
              if (fs.existsSync(__dirname + "/data/" + guild.id + "/config.json")) {
                var json = fs.readFileSync(__dirname + "/data/" + guild.id + "/config.json");
                var obj = JSON.parse(json);
                if (obj.var) eval(obj.var);
                if (obj.${event}) eval(obj.${event});
              }
            });`)
      } catch (e) {
        console.exception(e);
      }
    }
  }
})

boot();