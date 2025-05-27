# Homebridge Smart Toilet Seat

## Introduction
Welcome to the Smart Toilet Seat plugin for [Homebridge](https://github.com/nfarina/homebridge).

This plugin allows you to control your smart toilet seat with HomeKit using the Home app and Siri via IR commands sent through Broadlink devices.

## Features
- **Power Control**: Turn toilet seat on/off
- **Power Save Mode**: Enable/disable power save functionality  
- **Shower Function**: Control shower/cleansing function with auto-off after 60 seconds
- **Bidet Function**: Control bidet function with auto-off after 60 seconds
- **Dry Function**: Control drying function with auto-off after 60 seconds

## Installation

1. Install homebridge if you haven't already
2. Install this plugin: `npm install -g homebridge-toilet-seat`
3. Update your configuration file

## Configuration

Add the following to your homebridge config.json:

```json
{
  "platforms": [
    {
      "platform": "IR-Toilet-Seat",
      "name": "Smart Toilet Seat Platform",
      "accessories": [
        {
          "name": "Smart Toilet Seat",
          "type": "smart-toilet-seat",
          "powerName": "Power",
          "powerSaveName": "Power Save",
          "showerName": "Shower", 
          "bidetName": "Bidet",
          "dryName": "Dry",
          "data": {
            "powerOn": "YOUR_POWER_ON_HEX_CODE",
            "powerOff": "YOUR_POWER_OFF_HEX_CODE",
            "powerSaveOn": "YOUR_POWER_SAVE_ON_HEX_CODE",
            "powerSaveOff": "YOUR_POWER_SAVE_OFF_HEX_CODE",
            "showerOn": "YOUR_SHOWER_ON_HEX_CODE",
            "showerOff": "YOUR_SHOWER_OFF_HEX_CODE",
            "bidetOn": "YOUR_BIDET_ON_HEX_CODE",
            "bidetOff": "YOUR_BIDET_OFF_HEX_CODE",
            "dryOn": "YOUR_DRY_ON_HEX_CODE",
            "dryOff": "YOUR_DRY_OFF_HEX_CODE"
          }
        }
      ]
    }
  ]
}
```

## Learning IR Codes

You'll need to capture the IR codes from your toilet seat's remote control. You can use the original homebridge-broadlink-rm plugin temporarily to learn codes, or use other IR learning tools.

## License
ISC
