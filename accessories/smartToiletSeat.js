const BroadlinkRMAccessory = require('./accessory');
const delayForDuration = require('../helpers/delayForDuration');
const catchDelayCancelError = require('../helpers/catchDelayCancelError');

class SmartToiletSeat extends BroadlinkRMAccessory {
  serviceType() {
    return global.Service.Switch;  // Use global Service
  }

  constructor(log, config = {}) {
    super(log, config);
    
    // Initialize state storage
    this.state = {
      power: { on: false },
      powerSave: { on: false },
      dry: { active: false, rotationSpeed: 0 },
      shower: { active: false },
      bidet: { active: false },
      massage: { active: false },
      seatTemp: { currentTemp: 35, targetTemp: 35 },
      waterTemp: { currentTemp: 35, targetTemp: 35 }
    };

    // Add services
    this.createServices();
  }

  reset() {
    super.reset();

    // Clear any timeouts
    if (this.autoOffTimeoutPromises) {
      Object.values(this.autoOffTimeoutPromises).forEach(promise => {
        if (promise && promise.cancel) promise.cancel();
      });
    }
    this.autoOffTimeoutPromises = {};
  }

  createServices() {
    // Add base accessory information
    this.serviceInfo = new global.Service.AccessoryInformation();
    this.serviceInfo
      .setCharacteristic(global.Characteristic.Manufacturer, 'Smart Toilet')
      .setCharacteristic(global.Characteristic.Model, 'Smart Toilet Seat')
      .setCharacteristic(global.Characteristic.SerialNumber, 'STS-001');

    // Create power switches
    this.powerService = this.createSwitchService('power', 'Power');
    this.powerSaveService = this.createSwitchService('powerSave', 'Power Save Mode');

    // Create dry function (fan)
    this.dryService = this.createFanService();

    // Create water services (valves)
    this.showerService = this.createValveService('shower', 'Shower', 3); // Shower type
    this.bidetService = this.createValveService('bidet', 'Bidet', 1);    // Generic valve type
    this.massageService = this.createValveService('massage', 'Massage', 0); // Generic valve type

    // Create temperature controls
    this.seatTempService = this.createThermostatService('seatTemp', 'Seat Temperature');
    this.waterTempService = this.createThermostatService('waterTemp', 'Water Temperature');
  }

  createSwitchService(id, name) {
    const service = new global.Service.Switch(name, id);
    
    service.getCharacteristic(global.Characteristic.On)
      .onGet(() => this.state[id].on)
      .onSet(async (value) => {
        this.state[id].on = value;
        const hexData = this.data[id][value ? 'on' : 'off'];
        await this.performSend(hexData);
      });

    return service;
  }

  createFanService() {
    const service = new global.Service.Fanv2('Dry Function', 'dry');
    
    service.getCharacteristic(global.Characteristic.Active)
      .onGet(() => this.state.dry.active)
      .onSet(async (value) => {
        this.state.dry.active = value;
        const hexData = this.data.dry[value ? 'on' : 'off'];
        await this.performSend(hexData);
      });

    service.getCharacteristic(global.Characteristic.RotationSpeed)
      .onGet(() => this.state.dry.rotationSpeed)
      .onSet(async (value) => {
        this.state.dry.rotationSpeed = value;
        let hexData;
        
        if (value <= 33) hexData = this.data.dry.fanSpeed10;
        else if (value <= 66) hexData = this.data.dry.fanSpeed50;
        else hexData = this.data.dry.fanSpeed100;
        
        await this.performSend(hexData);
      });

    return service;
  }

  createValveService(id, name, valveType) {
    const service = new global.Service.Valve(name, id);
    
    // Set valve type
    service.setCharacteristic(global.Characteristic.ValveType, valveType);
    
    // Set default duration to 60 seconds
    service.setCharacteristic(global.Characteristic.SetDuration, 60);

    service.getCharacteristic(global.Characteristic.Active)
      .onGet(() => this.state[id].active)
      .onSet(async (value) => {
        this.state[id].active = value;
        
        if (value) {
          await this.performSend(this.data[id].on);
          // Start auto-off timer
          const duration = service.getCharacteristic(global.Characteristic.SetDuration).value;
          this.startAutoOffTimer(id, service, duration);
        } else {
          await this.performSend(this.data[id].off);
        }
        
        // Update InUse characteristic
        service.updateCharacteristic(global.Characteristic.InUse, value);
      });

    service.getCharacteristic(global.Characteristic.InUse)
      .onGet(() => this.state[id].active);

    return service;
  }

  createThermostatService(id, name) {
    const service = new global.Service.Thermostat(name, id);
    
    service
      .setCharacteristic(global.Characteristic.TemperatureDisplayUnits, global.Characteristic.TemperatureDisplayUnits.CELSIUS)
      .setCharacteristic(global.Characteristic.CurrentTemperature, this.state[id].currentTemp)
      .setCharacteristic(global.Characteristic.TargetTemperature, this.state[id].targetTemp);

    service.getCharacteristic(global.Characteristic.TargetTemperature)
      .onGet(() => this.state[id].targetTemp)
      .onSet(async (value) => {
        const oldTemp = this.state[id].targetTemp;
        this.state[id].targetTemp = value;
        
        // Send appropriate IR commands based on temperature change
        if (value > oldTemp) {
          await this.performSend(this.data[id].temperatureUp);
        } else if (value < oldTemp) {
          await this.performSend(this.data[id].temperatureDown);
        }
        
        // Update current temperature to match target after a delay
        await delayForDuration(1);
        this.state[id].currentTemp = value;
        service.updateCharacteristic(global.Characteristic.CurrentTemperature, value);
      });

    return service;
  }

  async startAutoOffTimer(id, service, duration) {
    // Clear any existing timer
    if (this.autoOffTimeoutPromises?.[id]) {
      this.autoOffTimeoutPromises[id].cancel();
    }

    try {
      this.autoOffTimeoutPromises = this.autoOffTimeoutPromises || {};
      this.autoOffTimeoutPromises[id] = delayForDuration(duration);
      await this.autoOffTimeoutPromises[id];
      
      // Turn off the service after duration
      service.updateCharacteristic(global.Characteristic.Active, false);
      service.updateCharacteristic(global.Characteristic.InUse, false);
      this.state[id].active = false;
      await this.performSend(this.data[id].off);
    } catch (err) {
      if (err.message !== 'timeout cancelled') throw err;
    }
  }

  getServices() {
    return [
      this.serviceInfo,
      this.powerService,
      this.powerSaveService,
      this.dryService,
      this.showerService,
      this.bidetService,
      this.massageService,
      this.seatTempService,
      this.waterTempService
    ];
  }
}

module.exports = SmartToiletSeat;