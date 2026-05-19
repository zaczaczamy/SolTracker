const config = {
    // AUTHENTICATION (REQUIRED)
    "token": "jugf1DxL8#PBaUy2zeG1a5hcVzhoSBJpDBOZmuOrXte7MW2iCjsI#iJp0Kq^k9D$wZu$X!LJruYtuDNJry3Ho0GnZ6TjYMGHvhcRprMqY9JSWqDvcKlgXnWiDvx5wNrw",
    "webhookURL": "https://discord.com/api/webhooks/1504121127281098823/jt64o3iRBH36DY0jCyTvQkQYCTQOz_MFlWs5hEOgg6cYnvEy61EcXcxsLcu2e1r7hewL",

    // COMMAND CHANNEL — only !linked / !unlinked commands from this channel are accepted
    "commandChannelId": "1504117473862221955",

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
    "reconnectOnDuplicateConnection": false,

    "verboseLogging": true,
};

module.exports = config;
