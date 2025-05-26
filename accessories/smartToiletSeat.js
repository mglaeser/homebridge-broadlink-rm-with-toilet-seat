const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {

  serviceType() { return Service.Switch }

  constructor(log, config = {}) {
    // Ensure required properties
    if (!config.name) config.name = "Smart Toilet Seat";
    
    // Convert numeric hex codes to strings BEFORE super()
    SmartToiletSeat.convertConfigHexCodes(config);
    
    super(log, config);
    
    this.checkConfig(config);
    
    // Initialize state for additional functions
    this.toiletState = {
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

  // Water function with auto-off
  async setWaterFunction(functionType, active) {
    const { data, log, name } = this;
    const stateKey = `${functionType}Active`;
    const hexKey = `${functionType}${active ? 'On' : 'Off'}`;
    
    if (data[hexKey]) {
      await this.performSend(data[hexKey]);
      this.toiletState[stateKey] = active;
      
      // Clear existing timeout
      if (this.waterFunctionTimeouts[functionType]) {
        clearTimeout(this.waterFunctionTimeouts[functionType]);
        delete this.waterFunctionTimeouts[functionType];
      }
      
      // Set auto-off for water functions (60 seconds)
      if (active) {
        log(`${name} ${functionType}: Auto-off in 60 seconds`);
        this.waterFunctionTimeouts[functionType] = setTimeout(async () => {
          this.toiletState[stateKey] = false;
          await this.performSend(data[`${functionType}Off`]);
          delete this.waterFunctionTimeouts[functionType];
        }, 60000);
      }
    }
  }

  // Override getServices to create multiple services using direct HAP-NodeJS API
  getServices() {
    const { config, name, log } = this;
    const { data } = config;
    
    const services = [];
    
    // Accessory Information Service (required)
    const accessoryInformation = new Service.AccessoryInformation();
    accessoryInformation
      .setCharacteristic(Characteristic.Manufacturer, 'Smart Toilet')
      .setCharacteristic(Characteristic.Model, 'Toilet Seat')
      .setCharacteristic(Characteristic.SerialNumber, 'STS-001');
    services.push(accessoryInformation);

    // 1. Main Power Service (Switch) - Primary service
    const powerService = new Service.Switch('Power', 'power');
    powerService.getCharacteristic(Characteristic.On)
      .onGet(() => {
        log(`${name} getPowerState: ${this.state.switchState || false}`);
        return this.state.switchState || false;
      })
      .onSet(async (value) => {
        log(`${name} setPowerState: ${value}`);
        this.state.switchState = value;
        const hexData = value ? data.powerOn : data.powerOff;
        if (hexData) await this.performSend(hexData);
      });
    services.push(powerService);

    // 2. Power Save Service (Outlet)
    const powerSaveService = new Service.Outlet('Power Save', 'powersave');
    powerSaveService.getCharacteristic(Characteristic.On)
      .onGet(() => {
        log(`${name} getPowerSaveState: ${this.toiletState.powerSaveState}`);
        return this.toiletState.powerSaveState;
      })
      .onSet(async (value) => {
        log(`${name} setPowerSaveState: ${value}`);
        this.toiletState.powerSaveState = value;
        const hexData = value ? data.powerSaveOn : data.powerSaveOff;
        if (hexData) await this.performSend(hexData);
      });
    
    powerSaveService.getCharacteristic(Characteristic.OutletInUse)
      .onGet(() => this.toiletState.powerSaveState);
    services.push(powerSaveService);

    // 3. Shower Service (Valve)
    const showerService = new Service.Valve('Shower', 'shower');
    showerService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.SHOWER);
    showerService.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        log(`${name} getShowerActive: ${this.toiletState.showerActive}`);
        return this.toiletState.showerActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
      })
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        log(`${name} setShowerActive: ${isActive}`);
        await this.setWaterFunction('shower', isActive);
      });
    
    showerService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.toiletState.showerActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    services.push(showerService);

    // 4. Bidet Service (Valve)
    const bidetService = new Service.Valve('Bidet', 'bidet');
    bidetService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.SHOWER);
    bidetService.getCharacteristic(Characteristic.Active)
      .onGet(() => {
        log(`${name} getBidetActive: ${this.toiletState.bidetActive}`);
        return this.toiletState.bidetActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
      })
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        log(`${name} setBidetActive: ${isActive}`);
        await this.setWaterFunction('bidet', isActive);
      });
    
    bidetService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.toiletState.bidetActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    services.push(bidetService);

    // 5. Dry Service (Fan)
    const dryService = new Service.Fan('Dry', 'dry');
    dryService.getCharacteristic(Characteristic.On)
      .onGet(() => {
        log(`${name} getDryActive: ${this.toiletState.dryActive}`);
        return this.toiletState.dryActive;
      })
      .onSet(async (value) => {
        log(`${name} setDryActive: ${value}`);
        this.toiletState.dryActive = value;
        const hexData = value ? data.dryOn : data.dryOff;
        if (hexData) await this.performSend(hexData);
      });
    services.push(dryService);

    return services;
  }

  // Required by BroadlinkRMAccessory but we override with getServices
  configureServiceManager(serviceManager) {
    // This method is required by the base class but not used
    // since we override getServices() to create our services directly
  }

  // Clean up timeouts when accessory is removed
  destroy() {
    Object.values(this.waterFunctionTimeouts).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    this.waterFunctionTimeouts = {};
  }
}

module.exports = SmartToiletSeat;