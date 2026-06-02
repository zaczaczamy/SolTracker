const config = {
    // AUTHENTICATION (REQUIRED)
    "token": "zva$f3O0^Dv&GVF&88F&jDUzy9kdD@RorwiXZvZOFJ@9t7@b3&2RUn0XkRdv&lU#Iwsem4U^y4DYOsGYe$ZjxD$c7oH8hmHH@PdJZa2qEL2PUuUN@qChJ2GQXj*oleUE",
    "webhookURL": "https://discord.com/api/webhooks/1504121127281098823/jt64o3iRBH36DY0jCyTvQkQYCTQOz_MFlWs5hEOgg6cYnvEy61EcXcxsLcu2e1r7hewL",

    // COMMAND CHANNEL — only !linked / !unlinked commands from this channel are accepted
    "commandChannelId": "1504117473862221955","1506247739690848396",

    // WEBHOOK USER (OPTIONAL)
    "overrideUsername": null,
    "overrideAvatarURL": null,

    "colors": {
        "success": "#6ab183",
        "error": "#d85a4b",
        "none": "#777f8d"
    },

    "emojis": {
        "success": "<:green_tick:1365702693326422026>",
        "error": "<:red_tick:1365702694727188491>",
        "none": "<:gray_tick:1365702690985738390>"
    },

    // ADVANCED CONFIGURATION (OPTIONAL) - DO NOT CHANGE THESE UNLESS YOU KNOW WHAT YOU'RE DOING
    "gatewayURL": "wss://api.mongoosee.com/solsstattracker/v2/gateway",

    "maxReconnectInterval": 120000,
    "reconnectOnDuplicateConnection": true,

    "verboseLogging": true,
};

module.exports = config;
