const SwitchAccessory = require('./switch');

class SmartToiletSeat extends SwitchAccessory {
  
  constructor(log, config = {}) {
    // Convert numeric hex codes to strings before passing to parent
    if (config.data) {
      Object.keys(config.data).forEach(key => {
        if (typeof config.data[key] === 'number') {
          config.data[key] = config.data[key].toString();
        }
      });
    }

    // Convert powerOn/powerOff to on/off format that switch expects
    if (config.data) {
      if (config.data.powerOn && !config.data.on) {
        config.data.on = config.data.powerOn;
      }
      if (config.data.powerOff && !config.data.off) {
        config.data.off = config.data.powerOff;
      }
    }

    super(log, config);
  }

  serviceType() {
    return Service.Switch;
  }
}

module.exports = SmartToiletSeat;