/**
 * Offline support with IndexedDB for check-in/check-out operations
 */

interface PendingOperation {
	id: string;
	type: "checkin" | "checkout" | "application";
	data: any;
	timestamp: number;
	retries: number;
}

class OfflineManager {
	private db: IDBDatabase | null = null;
	private readonly dbName = "VolunteerHubOffline";
	private readonly version = 1;

	async init(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, this.version);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Store for pending operations
				if (!db.objectStoreNames.contains("pendingOperations")) {
					const store = db.createObjectStore("pendingOperations", {
						keyPath: "id",
					});
					store.createIndex("type", "type");
					store.createIndex("timestamp", "timestamp");
				}

				// Cache for events data
				if (!db.objectStoreNames.contains("eventsCache")) {
					const eventsStore = db.createObjectStore("eventsCache", {
						keyPath: "id",
					});
					eventsStore.createIndex("lastUpdated", "lastUpdated");
				}

				// Cache for user data
				if (!db.objectStoreNames.contains("userCache")) {
					db.createObjectStore("userCache", { keyPath: "key" });
				}
			};
		});
	}

	async addPendingOperation(
		operation: Omit<PendingOperation, "id" | "retries">,
	): Promise<void> {
		if (!this.db) await this.init();

		const fullOperation: PendingOperation = {
			...operation,
			id: `${operation.type}_${Date.now()}_${Math.random()}`,
			retries: 0,
		};

		const transaction = this.db!.transaction(
			["pendingOperations"],
			"readwrite",
		);
		const store = transaction.objectStore("pendingOperations");

		return new Promise((resolve, reject) => {
			const request = store.add(fullOperation);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async getPendingOperations(): Promise<PendingOperation[]> {
		if (!this.db) await this.init();

		const transaction = this.db!.transaction(["pendingOperations"], "readonly");
		const store = transaction.objectStore("pendingOperations");

		return new Promise((resolve, reject) => {
			const request = store.getAll();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async removePendingOperation(id: string): Promise<void> {
		if (!this.db) await this.init();

		const transaction = this.db!.transaction(
			["pendingOperations"],
			"readwrite",
		);
		const store = transaction.objectStore("pendingOperations");

		return new Promise((resolve, reject) => {
			const request = store.delete(id);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async cacheEventData(eventId: number, data: any): Promise<void> {
		if (!this.db) await this.init();

		const cacheEntry = {
			id: eventId,
			data,
			lastUpdated: Date.now(),
		};

		const transaction = this.db!.transaction(["eventsCache"], "readwrite");
		const store = transaction.objectStore("eventsCache");

		return new Promise((resolve, reject) => {
			const request = store.put(cacheEntry);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async getCachedEventData(eventId: number): Promise<any | null> {
		if (!this.db) await this.init();

		const transaction = this.db!.transaction(["eventsCache"], "readonly");
		const store = transaction.objectStore("eventsCache");

		return new Promise((resolve, reject) => {
			const request = store.get(eventId);
			request.onsuccess = () => {
				const result = request.result;
				// Check if cache is not older than 1 hour
				if (result && Date.now() - result.lastUpdated < 3600000) {
					resolve(result.data);
				} else {
					resolve(null);
				}
			};
			request.onerror = () => reject(request.error);
		});
	}

	async syncPendingOperations(): Promise<{ success: number; failed: number }> {
		const operations = await this.getPendingOperations();
		let success = 0;
		let failed = 0;

		for (const operation of operations) {
			try {
				await this.executeOperation(operation);
				await this.removePendingOperation(operation.id);
				success++;
			} catch (error) {
				console.error("Failed to sync operation:", operation, error);

				// Increment retry count
				operation.retries++;

				// Remove after 5 failed attempts
				if (operation.retries >= 5) {
					await this.removePendingOperation(operation.id);
					failed++;
				} else {
					// Update retry count
					const transaction = this.db!.transaction(
						["pendingOperations"],
						"readwrite",
					);
					transaction.objectStore("pendingOperations").put(operation);
				}
			}
		}

		return { success, failed };
	}

	private async executeOperation(operation: PendingOperation): Promise<void> {
		const { type, data } = operation;

		switch (type) {
			case "checkin":
				await fetch("/checkin/process", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(data),
				});
				break;

			case "checkout":
				await fetch("/checkout/process", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(data),
				});
				break;

			case "application":
				await fetch("/applications", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(data),
				});
				break;

			default:
				throw new Error(`Unknown operation type: ${type}`);
		}
	}
}

// Global offline manager instance
export const offlineManager = new OfflineManager();

/**
 * Frontend JavaScript for offline support
 */
export const OfflineJS = `
  // Initialize offline manager
  window.offlineManager = new (${OfflineManager.toString()})();
  window.offlineManager.init();

  // Online/offline status tracking
  let isOnline = navigator.onLine;
  let syncInProgress = false;

  window.addEventListener('online', async () => {
    isOnline = true;
    updateOfflineStatus();
    
    if (!syncInProgress) {
      syncInProgress = true;
      try {
        const result = await window.offlineManager.syncPendingOperations();
        if (result.success > 0) {
          showToast(\`Синхронизировано \${result.success} операций\`, 'success');
        }
        if (result.failed > 0) {
          showToast(\`Не удалось синхронизировать \${result.failed} операций\`, 'warning');
        }
      } catch (error) {
        console.error('Sync failed:', error);
      } finally {
        syncInProgress = false;
      }
    }
  });

  window.addEventListener('offline', () => {
    isOnline = false;
    updateOfflineStatus();
    showToast('Вы офлайн. Операции будут синхронизированы при подключении.', 'warning');
  });

  function updateOfflineStatus() {
    const banner = document.getElementById('offline-banner');
    if (!isOnline) {
      if (!banner) {
        const offlineBanner = document.createElement('div');
        offlineBanner.id = 'offline-banner';
        offlineBanner.className = 'fixed top-0 left-0 right-0 bg-orange-600 text-white text-center py-2 z-50';
        offlineBanner.innerHTML = \`
          <div class="flex items-center justify-center">
            <i data-lucide="wifi-off" class="w-4 h-4 mr-2"></i>
            Нет подключения к интернету
          </div>
        \`;
        document.body.appendChild(offlineBanner);
        lucide.createIcons();
      }
    } else {
      if (banner) {
        banner.remove();
      }
    }
  }

  // Enhanced fetch with offline support
  window.offlineFetch = async function(url, options = {}) {
    if (isOnline) {
      try {
        return await fetch(url, options);
      } catch (error) {
        // Network error - treat as offline
        isOnline = false;
        updateOfflineStatus();
        throw error;
      }
    } else {
      throw new Error('Offline mode');
    }
  };

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', updateOfflineStatus);
`;

/**
 * Offline-aware check-in function
 */
export async function offlineCheckin(
	applicationId: string,
	shiftId: string,
	location?: LocationData,
): Promise<boolean> {
	const checkinData = {
		application_id: applicationId,
		shift_id: shiftId,
		location: location ? `${location.latitude},${location.longitude}` : null,
		timestamp: new Date().toISOString(),
	};

	try {
		// Try online first
		const response = await fetch("/checkin/process", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				qr_data: `CHECKIN:${applicationId}:${shiftId}:${Date.now()}`,
			}),
		});

		if (response.ok) {
			return true;
		}
	} catch (error) {
		console.log("Online checkin failed, storing offline:", error);
	}

	// Store for offline sync
	await offlineManager.addPendingOperation({
		type: "checkin",
		data: checkinData,
		timestamp: Date.now(),
	});

	return true;
}
