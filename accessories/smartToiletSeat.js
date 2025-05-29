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
  }

  setDefaults() {
    const { config } = this;
    
    // Set default auto-off duration for water functions
    config.waterFunctionDuration = config.waterFunctionDuration || 60;
    // Fixed: Clean logic for dry function duration
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
        this.log(`Error clearing timeout for ${key}: ${error.message}`);
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
              
              // Update service characteristic safely
              const serviceManager = this.serviceManagers[functionType];
              if (serviceManager && serviceManager.setCharacteristic) {
                serviceManager.setCharacteristic(Characteristic.On, false);
              }
              
              delete this.waterFunctionTimeouts[functionType];
              
              if (logLevel <= 2) {
                log(`${name} ${functionType}: Auto-off executed`);
              }
            } catch (timeoutError) {
              if (logLevel <= 4) {
                log(`${name} ${functionType} auto-off error: ${timeoutError.message}`);
              }
              // Clean up timeout reference even if error occurs
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
              
              // Update service characteristic safely
              if (this.serviceManagers.dry && this.serviceManagers.dry.setCharacteristic) {
                this.serviceManagers.dry.setCharacteristic(Characteristic.On, false);
              }
              
              delete this.waterFunctionTimeouts.dry;
              
              if (logLevel <= 2) {
                log(`${name} Dry: Auto-off executed`);
              }
            } catch (timeoutError) {
              if (logLevel <= 4) {
                log(`${name} Dry auto-off error: ${timeoutError.message}`);
              }
              // Clean up timeout reference even if error occurs
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

  // Improved getServices method with error handling
  getServices() {
    const services = this.getInformationServices();
    
    try {
      // Add primary service
      if (this.serviceManager && this.serviceManager.service) {
        services.push(this.serviceManager.service);
      }
      
      // Add secondary services safely
      if (this.serviceManagers) {
        Object.values(this.serviceManagers).forEach(serviceManager => {
          if (serviceManager && serviceManager.service) {
            services.push(serviceManager.service);
          }
        });
      }
    } catch (error) {
      this.log(`Error getting services: ${error.message}`);
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
      return;
    }

    const { 
      powerOn, powerOff, powerSaveOn, powerSaveOff, 
      showerOn, showerOff, bidetOn, bidetOff, 
      dryOn, dryOff 
    } = data;

    // Validate required hex codes
    const requiredCodes = [
      'powerOn', 'powerOff', 'powerSaveOn', 'powerSaveOff',
      'showerOn', 'showerOff', 'bidetOn', 'bidetOff',
      'dryOn', 'dryOff'
    ];
    
    const missingCodes = requiredCodes.filter(code => !data[code]);
    if (missingCodes.length > 0 && logLevel <= 3) {
      log(`${name} Warning: Missing hex codes: ${missingCodes.join(', ')}`);
    }

    try {
      // Create service managers object to hold multiple services
      this.serviceManagers = {};

      // 1. Main Power Switch (Primary Service)
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

      // 2. Power Save Switch
      const powerSaveName = config.powerSaveName || 'Power Save';
      this.serviceManagers.powerSave = new ServiceManagerTypes[serviceManagerType](
        powerSaveName, Service.Switch, this.log
      );
      
      this.serviceManagers.powerSave.addToggleCharacteristic({
        name: 'powerSaveState',
        type: Characteristic.On,
        getMethod: this.getPowerSaveState.bind(this),
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          onData: powerSaveOn,
          offData: powerSaveOff,
          setValuePromise: this.setPowerSaveState.bind(this)
        }
      });

      // 3. Shower Switch
      const showerName = config.showerName || 'Shower';
      this.serviceManagers.shower = new ServiceManagerTypes[serviceManagerType](
        showerName, Service.Switch, this.log
      );
      
      this.serviceManagers.shower.addToggleCharacteristic({
        name: 'showerState',
        type: Characteristic.On,
        getMethod: this.getShowerState.bind(this),
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          onData: showerOn,
          offData: showerOff,
          setValuePromise: (hexData, previousValue) => this.setWaterFunction('shower', hexData, previousValue)
        }
      });

      // 4. Bidet Switch
      const bidetName = config.bidetName || 'Bidet';
      this.serviceManagers.bidet = new ServiceManagerTypes[serviceManagerType](
        bidetName, Service.Switch, this.log
      );
      
      this.serviceManagers.bidet.addToggleCharacteristic({
        name: 'bidetState',
        type: Characteristic.On,
        getMethod: this.getBidetState.bind(this),
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          onData: bidetOn,
          offData: bidetOff,
          setValuePromise: (hexData, previousValue) => this.setWaterFunction('bidet', hexData, previousValue)
        }
      });

      // 5. Dry Fan
      const dryName = config.dryName || 'Dry';
      this.serviceManagers.dry = new ServiceManagerTypes[serviceManagerType](
        dryName, Service.Fan, this.log
      );
      
      this.serviceManagers.dry.addToggleCharacteristic({
        name: 'dryState',
        type: Characteristic.On,
        getMethod: this.getDryState.bind(this),
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          onData: dryOn,
          offData: dryOff,
          setValuePromise: this.setDryState.bind(this)
        }
      });

    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} Error setting up service managers: ${error.message}`);
      }
      throw error;
    }
  }
}

module.exports = SmartToiletSeatAccessory;