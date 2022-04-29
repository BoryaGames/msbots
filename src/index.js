/**
 * @ignore
 */
var WebSocket = require("websocket");
/**
 * @ignore
 */
var WebSocketClient = WebSocket.client;
/**
 * @ignore
 */
var EventEmitter = require("events");
/**
 * Base object for everything.
 */
class Base {
  constructor(bot) {
    this.bot = bot;
  }
}
/**
 * @extends Base
 * Data packet.
 */
class Packet extends Base {
  /**
   * Data packet constructor.
   * @param {string} [type=UNKNOWN] - Type.
   * @param {object} [data={}] - Data.
   */
  constructor(bot,t = "UNKNOWN",d = {}) {
    super(bot);
    /**
     * Type.
     */
    this.type = t;
    /**
     * Data.
     */
    this.data = d;
  }
  static parse(m) {
    m = JSON.parse(m.utf8Data);
    if (m.type == "ERROR") {
      return new ErrorPacket(m.data.type);
    } else {
      return new Packet(m.type,m.data);
    }
  }
  ws() {
    var d = JSON.stringify({"type":this.type,"data":this.data});
    this.bot.emit("debug",`[<-] ${this.type} (${d.length.toString()}B)`);
    this.bot.ws.con.sendUTF(d);
  }
}
/**
 * @extends Packet
 * Error data packet.
 */
class ErrorPacket extends Packet {
  constructor(t = "UNKNOWN") {
    super("ERROR",{"type":t});
  }
}
class Bot extends EventEmitter {
  constructor(options) {
    super();
    this.options = Object.assign({
      "selfMessage": !0,
      "intents": new Collection()
    },options);
    this.servers = new Collection();
    this.channels = new Collection();
    this.users = new Collection();
    this.user = null;
    this.token = null;
    this.ws = {"wsc":new WebSocketClient(),"secure":!0,"domain":"mscord.com","path":"/bot","con":null};
    this.readyAtTimestamp = null;
    this.readyAt = null;
    this.ws.wsc.on("connectFailed",()=>{
      this.ws.con = null;
    });
    this.ws.wsc.on("connect",con=>{
      this.ws.con = con;
      con.on("error",()=>{
        this.ws.con = null;
      });
      con.on("close",()=>{
        this.ws.con = null;
      });
      con.on("message",message=>{
        if (message.type == "utf8") {
          var packet = Packet.parse(message);
          this.emit("debug",`[->] ${packet.type} (${message.utf8Data.length.toString()}B)`);
          if (packet.type == "BOT_DATA") {
            this.user = packet.data.user;
            var gs = [];
            for (var g of packet.data.myguilds) {
              gs.push(new Server(this,g));
            }
            this.servers.add(...gs);
            for (var needIntent of this.options.intents.array()) {
              this.registerIntent(needIntent,()=>{
                this.options.intents.remove(needIntent);
              });
            }
            if (this.options.intents.size === 0) {
              this.setReady();
            } else {
              var i = setInterval(()=>{
                if (this.options.intents.size === 0) {
                  clearInterval(i);
                  this.setReady();
                }
              },1);
            }
          }
          if (packet instanceof ErrorPacket) {
            if (packet.data.type == "INVALID_TOKEN") {
              throw "INVALID_TOKEN";
            }
          }
          if (packet.type == "MESSAGE_CREATE") {
            var m = new Message(this,packet.data);
            if (this.selfMessage || m.author != this.user.id) {
              this.emit("messageCreate",m);
            }
          }
        }
      });
    });
  }
  get ready() {
    return !!this.readyAt;
  }
  isReady() {
    return this.ready;
  }
  get connected() {
    return !!this.ws.con;
  }
  isConnected() {
    return this.connected;
  }
  async authorize(type,token) {
    if (!type) {
      throw "TYPE_MISSING";
    }
    if (type != "BOT") {
      throw "TYPE_INVALID";
    }
    if (!token) {
      throw "TYPE_MISSING";
    }
    if (this.ready) {
      throw "ALREADY_READY";
    }
    if (!this.connected) {
      await this.connect();
    }
    this.token = {"type":type,"token":token};
    (new Packet(this,"LOGIN",{"tokentype":type,"token":token,"LISTEN_ALL_GUILDS":this.needIntents.has("LISTEN_ALL_GUILDS")})).ws();
    if (this.options.intents.has("LISTEN_ALL_GUILDS")) {
      this.options.intents.remove("LISTEN_ALL_GUILDS");
    }
  }
  connect() {
    if (this.connected) {
      throw "ALREADY_CONNECTED";
    }
    this.ws.wsc.connect(`ws${this.ws.secure?"s":""}://${this.ws.domain}${this.ws.path}`);
    return new Promise((r)=>{
      let i = setInterval(()=>{
        if (this.connected) {
          clearInterval(i);
          r();
        }
      },1);
    });
  }
  registerIntent(t,f) {
    if (!this.intents[t]) {
      this.intents[t] = new Collection();
    }
    this.intents[t].add(f);
  }
  setReady() {
    this.readyAtTimestamp = Date.now();
    this.readyAt = new Date(this.readyAtTimestamp);
    this.emit("ready");
  }
}
class Collection {
  constructor() {
    this.data = [];
  }
  add(...o) {
    this.data.push(...o);
  }
  remove(...o) {
    if (o.length > 1) {
      for (var oo of o) {
        this.remove(oo);
      }
    } else {
      this.data.splice(this.data.indexOf(o[0]),1);
    }
  }
  array() {
    return Object.assign([],this.data);
  }
  get size() {
    return this.data.length;
  }
  set size(newsize) {
    this.data.length = newsize;
  }
  filter(f) {
    return this.data.filter(f);
  }
  find(f) {
    return this.data.find(f);
  }
  getProperty(p,v) {
    return this.data.find(e=>e[p]==v);
  }
  has(e) {
    return this.data.includes(e);
  }
}
class Message extends Base {
  constructor(bot,data = {}) {
    super(bot);
    this.type = data.type;
    this.content = data.content;
    this.guilds = bot.guilds.getProperty("id",data.guild);
    this.channel = bot.channels.getProperty("id",data.channel);
    this.author = bot.users.getProperty("id",data.author);
    this.embeds = data.embeds.map(embed=>new SimpleEmbed(bot,embed));
    this.components = data.components.filter(component=>{
      return component.type == "BUTTON";
    }).map(component=>{
      if (component.type == "BUTTON") {
        return new SimpleButton(bot,component);
      }
    });
  }
}
class Server extends Base {
  constructor(bot,data = {}) {
    super(bot);
    this.name = data.name;
    this.id = data.id;
    this.channels = new Collection();
  }
}
module.exports = { Base, Packet, ErrorPacket, Bot, Collection, Message, Server };