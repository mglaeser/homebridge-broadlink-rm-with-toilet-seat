# Smart Toilet Seat for Homebridge

Control your smart toilet seat with HomeKit using Broadlink RM devices.

## Features

- **Main Power Control**: Turn your toilet seat on/off
- **Power Save Mode**: Enable/disable power saving mode  
- **Shower Function**: Control the shower/wash function with auto-off
- **Bidet Function**: Control the bidet function with auto-off
- **Dry Function**: Control the air dryer with auto-off
- **Learn IR Codes**: Built-in learning functionality for IR codes

## Installation

```bash
npm install -g homebridge-smart-toilet-seat
```

## Configuration

Add the following to your Homebridge config.json:

```json
{
    "platforms": [{
        "platform": "BroadlinkRM",
        "name": "Smart Toilet Seat",
        "hosts": [
            {
                "isRM4": true,
                "address": "192.168.1.100",
                "mac": "xx:xx:xx:xx:xx:xx"
            }
        ],
        "accessories": [
            {
                "name": "Smart Toilet",
                "type": "smart-toilet-seat",
                "waterFunctionDuration": 45,
                "dryDuration": 60,
                "bidetName": "Bidet",
                "showerName": "Shower",
                "dryName": "Dry",
                "powerSaveName": "Power Save",
                "data": {
                    "powerOn": "HEX_CODE_HERE",
                    "powerOff": "HEX_CODE_HERE",
                    "powerSaveOn": "HEX_CODE_HERE",
                    "powerSaveOff": "HEX_CODE_HERE",
                    "showerOn": "HEX_CODE_HERE",
                    "showerOff": "HEX_CODE_HERE",
                    "bidetOn": "HEX_CODE_HERE",
                    "bidetOff": "HEX_CODE_HERE",
                    "dryOn": "HEX_CODE_HERE",
                    "dryOff": "HEX_CODE_HERE"
                }
            }
        ]
    }]
}
```

## Learning IR Codes

1. The plugin automatically adds a "Learn" switch to HomeKit
2. Turn on the Learn switch
3. Point your toilet remote at the Broadlink device and press the button
4. The hex code will appear in the Homebridge logs
5. Copy the hex code to your config

## Configuration Options

- `waterFunctionDuration`: Auto-off time for shower/bidet functions (default: 60 seconds)
- `dryDuration`: Auto-off time for dry function (default: 60 seconds)  
- `bidetName`: Custom name for bidet function
- `showerName`: Custom name for shower function
- `dryName`: Custom name for dry function
- `powerSaveName`: Custom name for power save function

## Supported Devices

- Broadlink RM Mini 3
- Broadlink RM Pro
- Broadlink RM4 series
- Any Broadlink device with IR capability

## Troubleshooting

1. **Device not found**: Make sure your Broadlink device is on the same network
2. **IR codes not working**: Use the Learn function to capture codes directly from your remote
3. **Auto-off not working**: Check the duration settings in your config

## Credits

Based on the homebridge-broadlink-rm platform by kiwi-cam.
