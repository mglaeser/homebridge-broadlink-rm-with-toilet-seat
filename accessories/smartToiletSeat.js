const ServiceManagerTypes = require('../helpers/serviceManagerTypes');
const delayForDuration = require('../helpers/delayForDuration');
const catchDelayCancelError = require('../helpers/catchDelayCancelError');
const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeatAccessory extends BroadlinkRMAccessory {

  constructor(log, config = {}, serviceManagerType) {
    // Set default name if not provided
    if (!config.name) config.name = "Smart Toilet Seat";

    super(log, config, serviceManagerType);

    // Initialize toilet-specific state
    this.toiletState = {
      powerSaveState: false,
      showerActive: false,
      bidetActive: false,
      dryActive: false
    };

    this.waterFunctionTimeouts = {};
    this.additionalServices = [];
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

  // Main power switch handler
  async setPowerState(hexData, previousValue) {
    const { config, state, log, name, logLevel } = this;
    
    try {
      if (hexData) {
        await this.performSend(hexData);
        if (logLevel <= 2) {
          log(`${name} Power: ${state.switchState ? 'ON' : 'OFF'}`);
        }
      }
    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} Power control error: ${error.message}`);
      }
      throw error;
    }
  }

  // Water function handler with auto-off
  async setWaterFunction(functionType, active) {
    await catchDelayCancelError(async () => {
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
              
              // Update service characteristic
              const service = this.additionalServices.find(s => s.subtype === functionType);
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
    });
  }

  // Dry function handler with auto-off
  async setDryState(active) {
    await catchDelayCancelError(async () => {
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
              
              // Update service characteristic
              const service = this.additionalServices.find(s => s.subtype === 'dry');
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
    });
  }

  // Required by plugin architecture - creates PRIMARY service via ServiceManager
  setupServiceManager() {
    const { data, name, config, serviceManagerType, log, logLevel } = this;
    
    // Validate data exists
    if (!data) {
      const message = `${name}: No data configuration provided`;
      if (logLevel <= 4) {
        log(message);
      }
      throw new Error(message);
    }

    const { 
      powerOn, powerOff, powerSaveOn, powerSaveOff, 
      showerOn, showerOff, bidetOn, bidetOff, 
      dryOn, dryOff 
    } = data;

    // Validate required hex codes
    const requiredCodes = {
      powerOn: 'Main power on',
      powerOff: 'Main power off', 
      powerSaveOn: 'Power save on',
      powerSaveOff: 'Power save off',
      showerOn: 'Shower on',
      showerOff: 'Shower off',
      bidetOn: 'Bidet on', 
      bidetOff: 'Bidet off',
      dryOn: 'Dry on',
      dryOff: 'Dry off'
    };
    
    const missingCodes = Object.keys(requiredCodes).filter(code => !data[code]);
    if (missingCodes.length > 0) {
      const missing = missingCodes.map(code => requiredCodes[code]).join(', ');
      const message = `${name}: Missing required hex codes: ${missing}`;
      if (logLevel <= 4) {
        log(message);
      }
      throw new Error(message);
    }

    try {
      // Create PRIMARY service using ServiceManager (this is required by the plugin architecture)
      this.serviceManager = new ServiceManagerTypes[serviceManagerType](name, Service.Outlet, this.log);
      
      this.serviceManager.addToggleCharacteristic({
        name: 'switchState',
        type: Characteristic.On,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          onData: powerOn,
          offData: powerOff,
          setValuePromise: this.setPowerState.bind(this)
        }
      });

      // Create additional services manually
      this.createAdditionalServices();

      if (logLevel <= 2) {
        log(`${name}: Successfully configured with ${this.additionalServices.length + 1} services`);
      }

    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} Error setting up service managers: ${error.message}`);
      }
      throw error;
    }
  }

  // Create additional services (beyond the primary one)
  createAdditionalServices() {
    const { config, data, log, name } = this;
    
    this.additionalServices = [];

    // Power Save Switch
    const powerSaveName = config.powerSaveName || 'Power Save';
    const powerSaveService = new Service.Switch(powerSaveName, 'powerSave');
    powerSaveService.getCharacteristic(Characteristic.On)
      .onGet(() => this.toiletState.powerSaveState)
      .onSet(async (value) => {
        try {
          this.toiletState.powerSaveState = value;
          const hexData = value ? data.powerSaveOn : data.powerSaveOff;
          if (hexData) {
            await this.performSend(hexData);
          }
        } catch (error) {
          log(`${name} Power Save error: ${error.message}`);
        }
      });
    this.additionalServices.push(powerSaveService);

    // Shower Valve
    const showerName = config.showerName || 'Shower';
    const showerService = new Service.Valve(showerName, 'shower');
    showerService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
    showerService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.toiletState.showerActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        await this.setWaterFunction('shower', isActive);
      });
    showerService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.toiletState.showerActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    this.additionalServices.push(showerService);

    // Bidet Valve
    const bidetName = config.bidetName || 'Bidet';
    const bidetService = new Service.Valve(bidetName, 'bidet');
    bidetService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
    bidetService.getCharacteristic(Characteristic.Active)
      .onGet(() => this.toiletState.bidetActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        const isActive = value === Characteristic.Active.ACTIVE;
        await this.setWaterFunction('bidet', isActive);
      });
    bidetService.getCharacteristic(Characteristic.InUse)
      .onGet(() => this.toiletState.bidetActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
    this.additionalServices.push(bidetService);

    // Dry Fan
    const dryName = config.dryName || 'Dry';
    const dryService = new Service.Fan(dryName, 'dry');
    dryService.getCharacteristic(Characteristic.On)
      .onGet(() => this.toiletState.dryActive)
      .onSet(async (value) => {
        await this.setDryState(value);
      });
    this.additionalServices.push(dryService);
  }

  // Override parent's getServices to add our additional services
  getServices() {
    const services = this.getInformationServices();
    
    try {
      // Add primary service (handled by parent via ServiceManager)
      if (this.serviceManager && this.serviceManager.service) {
        services.push(this.serviceManager.service);
      }
      
      // Add all additional services
      this.additionalServices.forEach(service => {
        if (service) {
          services.push(service);
        }
      });

      // Add history service if enabled
      if (this.historyService && this.config.noHistory !== true) {
        services.push(this.historyService);
      }
    } catch (error) {
      if (this.logLevel <= 4) {
        this.log(`Error getting services: ${error.message}`);
      }
    }
    
    return services;
  }
}

module.exports = SmartToiletSeatAccessory;