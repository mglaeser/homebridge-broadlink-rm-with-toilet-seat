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

    // Clear all function timeouts with proper error handling
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

  // Main power switch
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

  // Power save function
  async setPowerSaveState(hexData, previousValue) {
    const { config, log, name, logLevel } = this;
    
    try {
      this.toiletState.powerSaveState = !previousValue;
      
      if (hexData) {
        await this.performSend(hexData);
        if (logLevel <= 2) {
          log(`${name} Power Save: ${this.toiletState.powerSaveState ? 'ON' : 'OFF'}`);
        }
      }
    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} Power save control error: ${error.message}`);
      }
      throw error;
    }
  }

  // Water function handler (shower/bidet) with improved error handling
  async setWaterFunction(functionType, hexData, previousValue) {
    await catchDelayCancelError(async () => {
      const { config, log, name, logLevel } = this;
      const stateKey = `${functionType}Active`;
      const isActive = !previousValue;
      
      try {
        this.toiletState[stateKey] = isActive;
        
        if (hexData) {
          await this.performSend(hexData);
          if (logLevel <= 2) {
            log(`${name} ${functionType.charAt(0).toUpperCase() + functionType.slice(1)}: ${isActive ? 'ON' : 'OFF'}`);
          }
        }

        // Clear existing timeout for this function
        if (this.waterFunctionTimeouts[functionType]) {
          clearTimeout(this.waterFunctionTimeouts[functionType]);
          delete this.waterFunctionTimeouts[functionType];
        }

        // Set auto-off timer if function is activated
        if (isActive) {
          const duration = config.waterFunctionDuration;
          if (logLevel <= 2) {
            log(`${name} ${functionType}: Auto-off in ${duration} seconds`);
          }
          
          this.waterFunctionTimeouts[functionType] = setTimeout(async () => {
            try {
              this.toiletState[stateKey] = false;
              
              // Send off command
              const offHexData = this.data[`${functionType}Off`];
              if (offHexData) {
                await this.performSend(offHexData);
              }
              
              // Update the correct service characteristic
              const service = this.additionalServices.find(s => s.displayName.toLowerCase().includes(functionType));
              if (service) {
                service.getCharacteristic(Characteristic.On).updateValue(false);
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

  // Dry function handler with improved error handling
  async setDryState(hexData, previousValue) {
    await catchDelayCancelError(async () => {
      const { config, log, name, logLevel } = this;
      const isActive = !previousValue;
      
      try {
        this.toiletState.dryActive = isActive;
        
        if (hexData) {
          await this.performSend(hexData);
          if (logLevel <= 2) {
            log(`${name} Dry: ${isActive ? 'ON' : 'OFF'}`);
          }
        }

        // Clear existing timeout
        if (this.waterFunctionTimeouts.dry) {
          clearTimeout(this.waterFunctionTimeouts.dry);
          delete this.waterFunctionTimeouts.dry;
        }

        // Set auto-off timer if activated
        if (isActive) {
          const duration = config.dryFunctionDuration;
          if (logLevel <= 2) {
            log(`${name} Dry: Auto-off in ${duration} seconds`);
          }
          
          this.waterFunctionTimeouts.dry = setTimeout(async () => {
            try {
              this.toiletState.dryActive = false;
              
              // Send off command
              const offHexData = this.data.dryOff;
              if (offHexData) {
                await this.performSend(offHexData);
              }
              
              // Update the correct service characteristic
              const service = this.additionalServices.find(s => s.displayName.toLowerCase().includes('dry'));
              if (service) {
                service.getCharacteristic(Characteristic.On).updateValue(false);
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

  // Getter methods for characteristics
  getPowerSaveState(callback) {
    callback(null, this.toiletState.powerSaveState);
  }

  getShowerState(callback) {
    callback(null, this.toiletState.showerActive);
  }

  getBidetState(callback) {
    callback(null, this.toiletState.bidetActive);
  }

  getDryState(callback) {
    callback(null, this.toiletState.dryActive);
  }

  // Fixed getServices method - properly returns all services
  getServices() {
    const services = this.getInformationServices();
    
    try {
      // Add primary service (main power switch)
      if (this.serviceManager && this.serviceManager.service) {
        services.push(this.serviceManager.service);
      }
      
      // Add all additional services
      this.additionalServices.forEach(service => {
        if (service) {
          services.push(service);
        }
      });
    } catch (error) {
      if (this.logLevel <= 4) {
        this.log(`Error getting services: ${error.message}`);
      }
    }
    
    return services;
  }

  setupServiceManager() {
    const { data, name, config, serviceManagerType, log, logLevel } = this;
    
    // Validate data exists
    if (!data) {
      if (logLevel <= 4) {
        log(`${name} Error: No data configuration provided`);
      }
      throw new Error(`${name}: No data configuration provided`);
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
      // 1. Main Power Switch (Primary Service) - uses parent's serviceManager
      this.serviceManager = new ServiceManagerTypes[serviceManagerType](name, Service.Switch, this.log);
      
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

      // 2. Create additional services as regular HomeKit services
      this.additionalServices = [];

      // Power Save Switch
      const powerSaveName = config.powerSaveName || 'Power Save';
      const powerSaveService = new Service.Switch(powerSaveName, 'powerSave');
      powerSaveService.getCharacteristic(Characteristic.On)
        .onGet(this.getPowerSaveState.bind(this))
        .onSet(async (value) => {
          const hexData = value ? powerSaveOn : powerSaveOff;
          await this.setPowerSaveState(hexData, !value);
        });
      this.additionalServices.push(powerSaveService);

      // Shower Switch  
      const showerName = config.showerName || 'Shower';
      const showerService = new Service.Switch(showerName, 'shower');
      showerService.getCharacteristic(Characteristic.On)
        .onGet(this.getShowerState.bind(this))
        .onSet(async (value) => {
          const hexData = value ? showerOn : showerOff;
          await this.setWaterFunction('shower', hexData, !value);
        });
      this.additionalServices.push(showerService);

      // Bidet Switch
      const bidetName = config.bidetName || 'Bidet';
      const bidetService = new Service.Switch(bidetName, 'bidet');
      bidetService.getCharacteristic(Characteristic.On)
        .onGet(this.getBidetState.bind(this))
        .onSet(async (value) => {
          const hexData = value ? bidetOn : bidetOff;
          await this.setWaterFunction('bidet', hexData, !value);
        });
      this.additionalServices.push(bidetService);

      // Dry Fan
      const dryName = config.dryName || 'Dry';
      const dryService = new Service.Fan(dryName, 'dry');
      dryService.getCharacteristic(Characteristic.On)
        .onGet(this.getDryState.bind(this))
        .onSet(async (value) => {
          const hexData = value ? dryOn : dryOff;
          await this.setDryState(hexData, !value);
        });
      this.additionalServices.push(dryService);

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
}

module.exports = SmartToiletSeatAccessory;