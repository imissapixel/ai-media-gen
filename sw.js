const CACHE_NAME = 'ai-media-gen-v1';
const urlsToCache = [
  '/manifest.json'
  // Note: Main app routes are handled by authentication middleware
];

// Install Service Worker
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch
self.addEventListener('fetch', function(event) {
  // Skip authentication routes and let server handle them
  if (event.request.url.includes('/login') || 
      event.request.url.includes('/logout') || 
      event.request.url.includes('/health')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          return response;
        }

        return fetch(event.request).then(
          function(response) {
            // Don't cache authentication-related responses or errors
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Skip caching HTML responses that might contain auth redirects
            if (response.headers.get('content-type') && 
                response.headers.get('content-type').includes('text/html')) {
              return response;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            var responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
    );
});

// Activate
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Background Job Queue Database Configuration
const JOB_DB_NAME = 'BackgroundJobsDB';
const JOB_DB_VERSION = 1;
const JOB_STORE_NAME = 'jobs';

// Initialize job queue database
function initJobDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(JOB_DB_NAME, JOB_DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(JOB_STORE_NAME)) {
        const store = db.createObjectStore(JOB_STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

// Handle messages from main app
self.addEventListener('message', async function(event) {
  const { type, jobData } = event.data;
  
  if (type === 'START_BACKGROUND_JOB') {
    console.log('Service worker received job:', jobData);
    await handleBackgroundJob(jobData);
  } else if (type === 'CHECK_JOB_STATUS') {
    const jobs = await getPendingJobs();
    event.ports[0].postMessage({ type: 'JOB_STATUS_RESPONSE', jobs });
  }
});

// Handle background job processing
async function handleBackgroundJob(jobData) {
  try {
    const db = await initJobDB();
    
    // Store job as pending
    const job = {
      ...jobData,
      status: 'pending',
      createdAt: Date.now(),
      startedAt: Date.now()
    };
    
    await storeJob(db, job);
    console.log('Job stored, starting processing:', job.id);
    
    // Process the webhook request
    await processWebhookJob(job);
    
  } catch (error) {
    console.error('Error handling background job:', error);
    // Update job status to failed
    const db = await initJobDB();
    await updateJobStatus(db, jobData.id, 'failed', { error: error.message });
  }
}

// Process webhook request in background
async function processWebhookJob(job) {
  const db = await initJobDB();
  
  try {
    console.log('Processing webhook job:', job.type, job.id);
    
    let response;
    
    if (job.type === 'video') {
      response = await fetch(job.webhookUrl, {
        method: 'POST',
        headers: job.headers,
        body: JSON.stringify(job.payload)
      });
    } else if (job.type === 'image') {
      // Reconstruct FormData for image requests
      const formData = new FormData();
      
      // Add form fields
      Object.entries(job.formFields).forEach(([key, value]) => {
        formData.append(key, value);
      });
      
      // Add image file if provided
      if (job.imageData) {
        const blob = new Blob([job.imageData.buffer], { type: job.imageData.type });
        formData.append('image', blob, job.imageData.fileName);
      }
      
      response = await fetch(job.webhookUrl, {
        method: 'POST',
        headers: job.headers,
        body: formData
      });
    }
    
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (err) {
        errorData = { message: 'The server returned an error, but the response was not valid JSON.' };
      }
      throw new Error(errorData.message || `HTTP error! Status: ${response.status}`);
    }
    
    // Get the result blob
    const resultBlob = await response.blob();
    
    // Verify content type
    const expectedType = job.type === 'video' ? 'video/' : 'image/';
    if (!resultBlob.type.startsWith(expectedType)) {
      throw new Error(`Expected ${expectedType} data, but received type: ${resultBlob.type}`);
    }
    
    // Store successful result
    await updateJobStatus(db, job.id, 'completed', { 
      resultBlob: resultBlob,
      completedAt: Date.now()
    });
    
    console.log('Job completed successfully:', job.id);
    
    // Notify main app if it's active
    notifyMainApp(job.id, 'completed');
    
  } catch (error) {
    console.error('Webhook job failed:', error);
    await updateJobStatus(db, job.id, 'failed', { 
      error: error.message,
      failedAt: Date.now()
    });
    
    // Notify main app of failure
    notifyMainApp(job.id, 'failed', error.message);
  }
}

// Database helper functions
async function storeJob(db, job) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([JOB_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(JOB_STORE_NAME);
    const request = store.put(job);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function updateJobStatus(db, jobId, status, additionalData = {}) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([JOB_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(JOB_STORE_NAME);
    
    const getRequest = store.get(jobId);
    getRequest.onsuccess = () => {
      const job = getRequest.result;
      if (job) {
        job.status = status;
        Object.assign(job, additionalData);
        
        const putRequest = store.put(job);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        reject(new Error('Job not found'));
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

async function getPendingJobs() {
  const db = await initJobDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([JOB_STORE_NAME], 'readonly');
    const store = transaction.objectStore(JOB_STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = () => {
      const allJobs = request.result;
      const pendingJobs = allJobs.filter(job => 
        job.status === 'pending' || job.status === 'completed'
      );
      resolve(pendingJobs);
    };
    request.onerror = () => reject(request.error);
  });
}

// Notify main app about job status changes
function notifyMainApp(jobId, status, error = null) {
  // Try to send message to all clients
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'JOB_STATUS_UPDATE',
        jobId: jobId,
        status: status,
        error: error
      });
    });
  });
}

// Handle background sync for job processing
self.addEventListener('sync', function(event) {
  if (event.tag === 'background-jobs') {
    event.waitUntil(processQueuedJobs());
  }
});

async function processQueuedJobs() {
  console.log('Processing queued background jobs');
  const db = await initJobDB();
  const jobs = await getPendingJobs();
  
  for (const job of jobs) {
    if (job.status === 'pending') {
      await processWebhookJob(job);
    }
  }
}