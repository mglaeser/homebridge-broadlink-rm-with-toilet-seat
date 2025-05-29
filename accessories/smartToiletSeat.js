const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeatAccessory extends BroadlinkRMAccessory {

  constructor(log, config = {}, serviceManagerType) {
    // Set default name if not provided
    if (!config.name) config.name = "Smart Toilet Seat";

    super(log, config, serviceManagerType);

    // Initialize toilet-specific state
    this.state = { switchState: false };
    this.toiletState = {
      powerSaveState: false,
      showerActive: false,
      bidetActive: false,
      dryActive: false
    };

    this.waterFunctionTimeouts = {};
  }

  setDefaults() {
    super.setDefaults();
    const { config } = this;
    
    // Set default auto-off duration for water functions
    config.waterFunctionDuration = config.waterFunctionDuration || 60;
    config.dryFunctionDuration = config.dryDuration || 60;
  }

  reset() {
    super.reset();

    // Clear all function timeouts
    Object.keys(this.waterFunctionTimeouts).forEach(key => {
      try {
        if (this.waterFunctionTimeouts[key]) {
          clearTimeout(this.waterFunctionTimeouts[key]);
          delete this.waterFunctionTimeouts[key];
        }
      } catch (error) {
        if (this.logLevel <= 4) {
          this.log(`Error clearing timeout for ${key}: ${error.message}`);
        }
      }
    });
  }

  async setWaterFunction(functionType, active) {
    const { config, log, name, logLevel, data } = this;
    const stateKey = `${functionType}Active`;
    
    try {
      this.toiletState[stateKey] = active;
      const hexData = active ? data[`${functionType}On`] : data[`${functionType}Off`];
      
      if (hexData) {
        await this.performSend(hexData);
        if (logLevel <= 2) {
          log(`${name} ${functionType}: ${active ? 'ON' : 'OFF'}`);
        }
      }

      // Clear existing timeout
      if (this.waterFunctionTimeouts[functionType]) {
        clearTimeout(this.waterFunctionTimeouts[functionType]);
        delete this.waterFunctionTimeouts[functionType];
      }

      // Set auto-off timer if activated
      if (active) {
        const duration = config.waterFunctionDuration;
        if (logLevel <= 2) {
          log(`${name} ${functionType}: Auto-off in ${duration} seconds`);
        }
        
        this.waterFunctionTimeouts[functionType] = setTimeout(async () => {
          try {
            this.toiletState[stateKey] = false;
            
            // Send off command
            const offHexData = data[`${functionType}Off`];
            if (offHexData) {
              await this.performSend(offHexData);
            }
            
            // Find and update the service
            const services = this.getServices();
            const service = services.find(s => s.subtype === functionType);
            if (service) {
              service.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
              service.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
            }
            
            delete this.waterFunctionTimeouts[functionType];
            
            if (logLevel <= 2) {
              log(`${name} ${functionType}: Auto-off executed`);
            }
          } catch (timeoutError) {
            if (logLevel <= 4) {
              log(`${name} ${functionType} auto-off error: ${timeoutError.message}`);
            }
            delete this.waterFunctionTimeouts[functionType];
          }
        }, duration * 1000);
      }
    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} ${functionType} control error: ${error.message}`);
      }
      throw error;
    }
  }

  async setDryState(active) {
    const { config, log, name, logLevel, data } = this;
    
    try {
      this.toiletState.dryActive = active;
      const hexData = active ? data.dryOn : data.dryOff;
      
      if (hexData) {
        await this.performSend(hexData);
        if (logLevel <= 2) {
          log(`${name} Dry: ${active ? 'ON' : 'OFF'}`);
        }
      }

      // Clear existing timeout
      if (this.waterFunctionTimeouts.dry) {
        clearTimeout(this.waterFunctionTimeouts.dry);
        delete this.waterFunctionTimeouts.dry;
      }

      // Set auto-off timer if activated
      if (active) {
        const duration = config.dryFunctionDuration;
        if (logLevel <= 2) {
          log(`${name} Dry: Auto-off in ${duration} seconds`);
        }
        
        this.waterFunctionTimeouts.dry = setTimeout(async () => {
          try {
            this.toiletState.dryActive = false;
            
            // Send off command
            const offHexData = data.dryOff;
            if (offHexData) {
              await this.performSend(offHexData);
            }
            
            // Find and update the service
            const services = this.getServices();
            const service = services.find(s => s.subtype === 'dry');
            if (service) {
              service.updateCharacteristic(Characteristic.On, false);
            }
            
            delete this.waterFunctionTimeouts.dry;
            
            if (logLevel <= 2) {
              log(`${name} Dry: Auto-off executed`);
            }
          } catch (timeoutError) {
            if (logLevel <= 4) {
              log(`${name} Dry auto-off error: ${timeoutError.message}`);
            }
            delete this.waterFunctionTimeouts.dry;
          }
        }, duration * 1000);
      }
    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} Dry control error: ${error.message}`);
      }
      throw error;
    }
  }

  // Bypass ServiceManager entirely - create all services manually
  setupServiceManager() {
    // Empty - we bypass ServiceManager and use getServices() directly
    const { log, name, logLevel } = this;
    if (logLevel <= 2) {
      log(`${name}: Bypassing ServiceManager, using direct service creation`);
    }
  }

  // Create all services manually - this is the main method
  getServices() {
    const { config, name, log, logLevel, data } = this;
    const services = [];

    // Validate data
    if (!data) {
      const message = `${name}: No data configuration provided`;
      if (logLevel <= 4) {
        log(message);
      }
      throw new Error(message);
    }

    // Validate required hex codes
    const requiredCodes = ['powerOn', 'powerOff', 'powerSaveOn', 'powerSaveOff', 'showerOn', 'showerOff', 'bidetOn', 'bidetOff', 'dryOn', 'dryOff'];
    const missingCodes = requiredCodes.filter(code => !data[code]);
    if (missingCodes.length > 0) {
      const message = `${name}: Missing hex codes: ${missingCodes.join(', ')}`;
      if (logLevel <= 4) {
        log(message);
      }
      throw new Error(message);
    }

    // Get service names from config
    const serviceNames = {
      power: name,
      powerSave: config.powerSaveName || 'Power Save', 
      shower: config.showerName || 'Shower',
      bidet: config.bidetName || 'Bidet',
      dry: config.dryName || 'Dry'
    };

    // 1. Accessory Information Service
    const accessoryInformation = new Service.AccessoryInformation();
    accessoryInformation
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer || 'Smart Toilet')
      .setCharacteristic(Characteristic.Model, this.model || 'Toilet Seat')
      .setCharacteristic(Characteristic.SerialNumber, this.serialNumber || 'STS-001');
    services.push(accessoryInformation);

    // 2. Main Power Outlet (Primary Service)
    const powerService = new Service.Outlet(serviceNames.power, 'power');
    powerService.setPrimaryService(true);
    
    powerService.getCharacteristic(Characteristic.On)
      .onGet(() => {
        return this.state.switchState;
      })
      .onSet(async (value) => {
        try {
          if (logLevel <= 2) {
            log(`${name} setPowerState: ${value}`);
          }
          this.state.switchState = value;
          const hexData = value ? data.powerOn : data.powerOff;
          if (hexData) {
            await this.performSend(hexData);
          }
        } catch (error) {
          if (logLevel <= 4) {
            log(`${name} Power error: ${error.message}`);
          }
          throw error;
        }
      });
    
    powerService.getCharacteristic(Characteristic.OutletInUse)
      .onGet(() => this.state.switchState);
    
    services.push(powerService);

    // 3. Power Save Switch
    const powerSaveService = new Service.Switch(serviceNames.powerSave, 'powersave');
    
    powerSaveService.getCharacteristic(Characteristic.On)
      .onGet(() => this.toiletState.powerSaveState)
      .onSet(async (value) => {
        try {
          if (logLevel <= 2) {
            log(`${name} setPowerSaveState: ${value}`);
          }
          this.toiletState.powerSaveState = value;
          const hexData = value ? data.powerSaveOn : data.powerSaveOff;
          if (hexData) {
            await this.performSend(hexData);
          }
        } catch (error) {
          if (logLevel <= 4) {
            log(`${name} Power Save error: ${error.message}`);
          }
          throw error;
        }
      });
    
    services.push(powerSaveService);

    // 4. Shower Valve
    const showerService = new Service.Valve(serviceNames.shower, 'shower');
    showerService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
    
    showerService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.toiletState.showerActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        await this.setWaterFunction('shower', isActive);
      });
    
    showerService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.toiletState.showerActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    
    services.push(showerService);

    // 5. Bidet Valve
    const bidetService = new Service.Valve(serviceNames.bidet, 'bidet');
    bidetService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
    
    bidetService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.toiletState.bidetActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        await this.setWaterFunction('bidet', isActive);
      });
    
    bidetService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.toiletState.bidetActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    
    services.push(bidetService);

    // 6. Dry Fan
    const dryService = new Service.Fan(serviceNames.dry, 'dry');
    
    dryService.getCharacteristic(Characteristic.On)
      .onGet(() => this.toiletState.dryActive)
      .onSet(async (value) => {
        await this.setDryState(value);
      });
    
    services.push(dryService);

    if (logLevel <= 2) {
      log(`${name}: Created ${services.length - 1} services: ${Object.values(serviceNames).join(', ')}`);
    }

    return services;
  }
}

module.exports = SmartToiletSeatAccessory;