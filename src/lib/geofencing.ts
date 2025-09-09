/**
 * Geofencing utilities for check-in validation
 */

export interface GeofenceConfig {
	latitude: number;
	longitude: number;
	radius: number; // meters
}

export interface LocationData {
	latitude: number;
	longitude: number;
	accuracy?: number;
	timestamp?: number;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 Latitude of first point
 * @param lon1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lon2 Longitude of second point
 * @returns Distance in meters
 */
export function calculateDistance(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	const R = 6371e3; // Earth's radius in meters
	const φ1 = (lat1 * Math.PI) / 180;
	const φ2 = (lat2 * Math.PI) / 180;
	const Δφ = ((lat2 - lat1) * Math.PI) / 180;
	const Δλ = ((lon2 - lon1) * Math.PI) / 180;

	const a =
		Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
		Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return R * c;
}

/**
 * Check if location is within geofence
 * @param userLocation User's current location
 * @param geofence Geofence configuration
 * @returns Object with validation result
 */
export function validateGeofence(
	userLocation: LocationData,
	geofence: GeofenceConfig,
): {
	valid: boolean;
	distance: number;
	message: string;
} {
	const distance = calculateDistance(
		userLocation.latitude,
		userLocation.longitude,
		geofence.latitude,
		geofence.longitude,
	);

	const valid = distance <= geofence.radius;

	return {
		valid,
		distance: Math.round(distance),
		message: valid
			? `Вы находитесь в зоне мероприятия (${Math.round(distance)}м от центра)`
			: `Вы находитесь слишком далеко от места мероприятия (${Math.round(distance)}м, требуется не более ${geofence.radius}м)`,
	};
}

/**
 * Request user location with error handling
 * @returns Promise with location data or error
 */
export function requestUserLocation(): Promise<LocationData> {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) {
			reject(new Error("Геолокация не поддерживается браузером"));
			return;
		}

		const options = {
			enableHighAccuracy: true,
			timeout: 10000,
			maximumAge: 60000, // 1 minute cache
		};

		navigator.geolocation.getCurrentPosition(
			(position) => {
				resolve({
					latitude: position.coords.latitude,
					longitude: position.coords.longitude,
					accuracy: position.coords.accuracy,
					timestamp: position.timestamp,
				});
			},
			(error) => {
				let message = "Ошибка определения местоположения";

				switch (error.code) {
					case error.PERMISSION_DENIED:
						message =
							"Доступ к геолокации запрещён. Разрешите доступ в настройках браузера.";
						break;
					case error.POSITION_UNAVAILABLE:
						message =
							"Местоположение недоступно. Проверьте GPS или подключение к интернету.";
						break;
					case error.TIMEOUT:
						message = "Превышено время ожидания определения местоположения.";
						break;
				}

				reject(new Error(message));
			},
			options,
		);
	});
}

/**
 * Frontend JavaScript for geofencing
 */
export const GeofencingJS = `
  window.GeofencingUtils = {
    async checkLocation(geofence) {
      try {
        const position = await this.getUserLocation();
        return this.validateDistance(position, geofence);
      } catch (error) {
        throw error;
      }
    },
    
    getUserLocation() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Геолокация не поддерживается'));
          return;
        }
        
        navigator.geolocation.getCurrentPosition(
          position => resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          }),
          error => {
            const messages = {
              1: 'Доступ к геолокации запрещён',
              2: 'Местоположение недоступно', 
              3: 'Превышено время ожидания'
            };
            reject(new Error(messages[error.code] || 'Ошибка геолокации'));
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
          }
        );
      });
    },
    
    validateDistance(userLocation, geofence) {
      const distance = this.calculateDistance(
        userLocation.latitude, userLocation.longitude,
        geofence.latitude, geofence.longitude
      );
      
      return {
        valid: distance <= geofence.radius,
        distance: Math.round(distance),
        message: distance <= geofence.radius 
          ? \`Вы в зоне мероприятия (\${Math.round(distance)}м)\`
          : \`Слишком далеко (\${Math.round(distance)}м, нужно <\${geofence.radius}м)\`
      };
    },
    
    calculateDistance(lat1, lon1, lat2, lon2) {
      const R = 6371e3;
      const φ1 = lat1 * Math.PI / 180;
      const φ2 = lat2 * Math.PI / 180;
      const Δφ = (lat2 - lat1) * Math.PI / 180;
      const Δλ = (lon2 - lon1) * Math.PI / 180;

      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return R * c;
    }
  };
`;

/**
 * Get geofence configuration for shift
 */
export function getShiftGeofence(shiftId: number): GeofenceConfig | null {
	// В реальном приложении запрос к БД
	// Для демо возвращаем тестовые координаты
	return {
		latitude: 59.9311, // Санкт-Петербург
		longitude: 30.3609,
		radius: 100, // 100 метров
	};
}
