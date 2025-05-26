const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {

  serviceType() { return Service.Switch } // Required by platform helper but not used

  constructor(log, config = {}) {
    // Ensure required properties
    if (!config.name) config.name = "Smart Toilet Seat";
    
    // Convert numeric hex codes to strings BEFORE super()
    SmartToiletSeat.convertConfigHexCodes(config);
    
    super(log, config);
    
    this.checkConfig(config);
    
    // Initialize state
    this.state = {
      powerState: false,
      powerSaveState: false,
      showerActive: false,
      bidetActive: false,
      dryActive: false
    };
    
    // Auto-off timeouts for water functions
    this.waterFunctionTimeouts = {};
  }

  static convertConfigHexCodes(config) {
    if (config.data) {
      Object.keys(config.data).forEach(key => {
        if (typeof config.data[key] === 'number') {
          config.data[key] = config.data[key].toString();
        }
      });
    }
  }

  checkConfig(config) {
    const { data } = config;
    if (!data) {
      this.log(`${config.name} checkConfig: No data found in config`);
      return;
    }

    const requiredCodes = ['powerOn', 'powerOff', 'powerSaveOn', 'powerSaveOff', 'showerOn', 'showerOff', 'bidetOn', 'bidetOff', 'dryOn', 'dryOff'];
    const missingCodes = requiredCodes.filter(code => !data[code]);
    if (missingCodes.length > 0) {
      this.log(`${config.name} checkConfig: Missing hex codes: ${missingCodes.join(', ')}`);
    } else {
      this.log(`${config.name} checkConfig: All required hex codes found`);
    }
  }

  // Override getServices to use direct Homebridge API instead of serviceManager
  getServices() {
    const { config, name, log } = this;
    const { data } = config;
    
    const services = [];
    
    // Accessory Information Service
    const accessoryInformation = new Service.AccessoryInformation();
    accessoryInformation
      .setCharacteristic(Characteristic.Manufacturer, 'Smart Toilet')
      .setCharacteristic(Characteristic.Model, 'Toilet Seat')
      .setCharacteristic(Characteristic.SerialNumber, 'STS-001');
    services.push(accessoryInformation);

    // 1. Main Power Service (Switch)
    const powerService = new Service.Switch('Power', 'power');
    powerService.getCharacteristic(Characteristic.On)
      .onGet(() => {
        log(`${name} getPowerState: ${this.state.powerState}`);
        return this.state.powerState;
      })
      .onSet(async (value) => {
        log(`${name} setPowerState: ${value}`);
        this.state.powerState = value;
        const hexData = value ? data.powerOn : data.powerOff;
        if (hexData) await this.performSend(hexData);
      });
    services.push(powerService);

    // 2. Power Save Service (Outlet with unique subtype)
    const powerSaveService = new Service.Outlet('Power Save', 'powersave');
    powerSaveService.getCharacteristic(Characteristic.On)
      .onGet(() => {
        log(`${name} getPowerSaveState: ${this.state.powerSaveState}`);
        return this.state.powerSaveState;
      })
      .onSet(async (value) => {
        log(`${name} setPowerSaveState: ${value}`);
        this.state.powerSaveState = value;
        const hexData = value ? data.powerSaveOn : data.powerSaveOff;
        if (hexData) await this.performSend(hexData);
      });
    
    // Outlet requires OutletInUse characteristic
    powerSaveService.getCharacteristic(Characteristic.OutletInUse)
      .onGet(() => this.state.powerSaveState);
    services.push(powerSaveService);

    // 3. Shower Service (Valve with unique subtype)
    const showerService = new Service.Valve('Shower', 'shower');
    showerService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.SHOWER);
    showerService.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        log(`${name} getShowerActive: ${this.state.showerActive}`);
        return this.state.showerActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
      })
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        log(`${name} setShowerActive: ${isActive}`);
        await this.setWaterFunction('shower', isActive);
      });
    
    showerService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.state.showerActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    services.push(showerService);

    // 4. Bidet Service (Valve with unique subtype)
    const bidetService = new Service.Valve('Bidet', 'bidet');
    bidetService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.SHOWER);
    bidetService.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        log(`${name} getBidetActive: ${this.state.bidetActive}`);
        return this.state.bidetActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
      })
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        log(`${name} setBidetActive: ${isActive}`);
        await this.setWaterFunction('bidet', isActive);
      });
    
    bidetService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.state.bidetActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    services.push(bidetService);

    // 5. Dry Service (Fan with unique subtype)
    const dryService = new Service.Fan('Dry', 'dry');
    dryService.getCharacteristic(Characteristic.On)
      .onGet(() => {
        log(`${name} getDryActive: ${this.state.dryActive}`);
        return this.state.dryActive;
      })
      .onSet(async (value) => {
        log(`${name} setDryActive: ${value}`);
        this.state.dryActive = value;
        const hexData = value ? data.dryOn : data.dryOff;
        if (hexData) await this.performSend(hexData);
      });
    services.push(dryService);

    return services;
  }

  // Water function with auto-off
  async setWaterFunction(functionType, active) {
    const { data, log, name } = this;
    const stateKey = `${functionType}Active`;
    const hexKey = `${functionType}${active ? 'On' : 'Off'}`;
    
    if (data[hexKey]) {
      await this.performSend(data[hexKey]);
      this.state[stateKey] = active;
      
      // Clear existing timeout
      if (this.waterFunctionTimeouts[functionType]) {
        clearTimeout(this.waterFunctionTimeouts[functionType]);
        delete this.waterFunctionTimeouts[functionType];
      }
      
      // Set auto-off for water functions (60 seconds)
      if (active) {
        log(`${name} ${functionType}: Auto-off in 60 seconds`);
        this.waterFunctionTimeouts[functionType] = setTimeout(async () => {
          this.state[stateKey] = false;
          await this.performSend(data[`${functionType}Off`]);
          delete this.waterFunctionTimeouts[functionType];
          
          // Update HomeKit - find the service and update it
          const services = this.getServices();
          const service = services.find(s => s.subtype === functionType);
          if (service) {
            service.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
            service.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
          }
        }, 60000);
      }
    }
  }

  // Clean up timeouts when accessory is removed
  destroy() {
    Object.values(this.waterFunctionTimeouts).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    this.waterFunctionTimeouts = {};
  }

  // Required by platform helper but not used since we override getServices
  configureServiceManager(serviceManager) {
    // Empty - we use getServices() instead
  }
}

module.exports = SmartToiletSeat;