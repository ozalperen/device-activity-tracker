/**
 * MongoDB Database Connection and Models
 * 
 * Persists tracking activity data for historical analysis.
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/device-activity-tracker';

// Tracked contact schema - persists contacts for auto-resume on restart
const trackedContactSchema = new mongoose.Schema({
    // Contact identifier (JID for WhatsApp, signal:number for Signal)
    contactId: { type: String, required: true, unique: true },
    
    // Platform: 'whatsapp' or 'signal'
    platform: { type: String, required: true, enum: ['whatsapp', 'signal'] },
    
    // Display number (clean phone number)
    number: { type: String, required: true },
    
    // Contact name (if available)
    name: { type: String },
    
    // When tracking was started
    createdAt: { type: Date, default: Date.now }
});

export const TrackedContact = mongoose.model('TrackedContact', trackedContactSchema);

// Activity record schema
const activityRecordSchema = new mongoose.Schema({
    // Contact identifier (JID for WhatsApp, signal:number for Signal)
    contactId: { type: String, required: true, index: true },
    
    // Platform: 'whatsapp' or 'signal'
    platform: { type: String, required: true, enum: ['whatsapp', 'signal'] },
    
    // Device state: 'Online', 'Standby', 'Calibrating', 'OFFLINE'
    state: { type: String, required: true },
    
    // Round-trip time in milliseconds
    rtt: { type: Number, required: true },
    
    // Threshold used for state determination
    threshold: { type: Number },
    
    // Timestamp of this activity record
    timestamp: { type: Date, default: Date.now, index: true }
});

// Compound index for efficient queries by contact and time
activityRecordSchema.index({ contactId: 1, timestamp: -1 });

export const ActivityRecord = mongoose.model('ActivityRecord', activityRecordSchema);

// Connection state
let isConnected = false;

/**
 * Connect to MongoDB
 */
export async function connectDB(): Promise<boolean> {
    if (isConnected) {
        return true;
    }

    try {
        await mongoose.connect(MONGODB_URI);
        isConnected = true;
        console.log('[DB] Connected to MongoDB');
        return true;
    } catch (error) {
        console.error('[DB] Failed to connect to MongoDB:', error);
        return false;
    }
}

/**
 * Save an activity record
 */
export async function saveActivityRecord(data: {
    contactId: string;
    platform: 'whatsapp' | 'signal';
    state: string;
    rtt: number;
    threshold?: number;
}): Promise<void> {
    if (!isConnected) {
        return; // Silently skip if DB not connected
    }

    try {
        await ActivityRecord.create({
            contactId: data.contactId,
            platform: data.platform,
            state: data.state,
            rtt: data.rtt,
            threshold: data.threshold,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('[DB] Failed to save activity record:', error);
    }
}

/**
 * Get activity history for a contact
 */
export async function getActivityHistory(
    contactId: string,
    options: {
        limit?: number;
        startDate?: Date;
        endDate?: Date;
    } = {}
): Promise<any[]> {
    if (!isConnected) {
        return [];
    }

    const { limit = 1000, startDate, endDate } = options;

    const query: any = { contactId };
    
    if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = startDate;
        if (endDate) query.timestamp.$lte = endDate;
    }

    try {
        return await ActivityRecord.find(query)
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();
    } catch (error) {
        console.error('[DB] Failed to get activity history:', error);
        return [];
    }
}

/**
 * Get all tracked contacts with their latest activity
 */
export async function getTrackedContactsSummary(): Promise<any[]> {
    if (!isConnected) {
        return [];
    }

    try {
        return await ActivityRecord.aggregate([
            {
                $sort: { timestamp: -1 }
            },
            {
                $group: {
                    _id: '$contactId',
                    platform: { $first: '$platform' },
                    lastState: { $first: '$state' },
                    lastRtt: { $first: '$rtt' },
                    lastSeen: { $first: '$timestamp' },
                    totalRecords: { $sum: 1 }
                }
            }
        ]);
    } catch (error) {
        console.error('[DB] Failed to get contacts summary:', error);
        return [];
    }
}

/**
 * Delete activity history for a contact
 */
export async function deleteContactHistory(contactId: string): Promise<void> {
    if (!isConnected) {
        return;
    }

    try {
        await ActivityRecord.deleteMany({ contactId });
        console.log(`[DB] Deleted history for ${contactId}`);
    } catch (error) {
        console.error('[DB] Failed to delete contact history:', error);
    }
}

/**
 * Get last seen online timestamp for a contact
 */
export async function getLastSeenOnline(contactId: string): Promise<{
    lastSeenOnline: Date | null;
    lastActivity: Date | null;
    currentState: string | null;
}> {
    if (!isConnected) {
        return { lastSeenOnline: null, lastActivity: null, currentState: null };
    }

    try {
        // Get the most recent "Online" state
        const lastOnline = await ActivityRecord.findOne({
            contactId,
            state: { $regex: /Online/i }
        }).sort({ timestamp: -1 }).lean();

        // Get the most recent activity regardless of state
        const lastActivity = await ActivityRecord.findOne({
            contactId
        }).sort({ timestamp: -1 }).lean();

        return {
            lastSeenOnline: lastOnline?.timestamp || null,
            lastActivity: lastActivity?.timestamp || null,
            currentState: lastActivity?.state || null
        };
    } catch (error) {
        console.error('[DB] Failed to get last seen:', error);
        return { lastSeenOnline: null, lastActivity: null, currentState: null };
    }
}

/**
 * Save a tracked contact
 */
export async function saveTrackedContact(data: {
    contactId: string;
    platform: 'whatsapp' | 'signal';
    number: string;
    name?: string;
}): Promise<void> {
    if (!isConnected) {
        return;
    }

    try {
        await TrackedContact.findOneAndUpdate(
            { contactId: data.contactId },
            {
                contactId: data.contactId,
                platform: data.platform,
                number: data.number,
                name: data.name,
                createdAt: new Date()
            },
            { upsert: true, new: true }
        );
        console.log(`[DB] Saved tracked contact: ${data.contactId}`);
    } catch (error) {
        console.error('[DB] Failed to save tracked contact:', error);
    }
}

/**
 * Remove a tracked contact
 */
export async function removeTrackedContact(contactId: string): Promise<void> {
    if (!isConnected) {
        return;
    }

    try {
        await TrackedContact.deleteOne({ contactId });
        console.log(`[DB] Removed tracked contact: ${contactId}`);
    } catch (error) {
        console.error('[DB] Failed to remove tracked contact:', error);
    }
}

/**
 * Get all tracked contacts
 */
export async function getTrackedContacts(): Promise<Array<{
    contactId: string;
    platform: 'whatsapp' | 'signal';
    number: string;
    name?: string;
}>> {
    if (!isConnected) {
        return [];
    }

    try {
        const contacts = await TrackedContact.find().lean();
        return contacts.map(c => ({
            contactId: c.contactId,
            platform: c.platform as 'whatsapp' | 'signal',
            number: c.number,
            name: c.name
        }));
    } catch (error) {
        console.error('[DB] Failed to get tracked contacts:', error);
        return [];
    }
}

/**
 * Update tracked contact name
 */
export async function updateTrackedContactName(contactId: string, name: string): Promise<void> {
    if (!isConnected) {
        return;
    }

    try {
        await TrackedContact.findOneAndUpdate(
            { contactId },
            { name }
        );
    } catch (error) {
        console.error('[DB] Failed to update contact name:', error);
    }
}

/**
 * Get last seen info for multiple contacts
 */
export async function getLastSeenBatch(contactIds: string[]): Promise<Map<string, {
    lastSeenOnline: Date | null;
    lastActivity: Date | null;
    currentState: string | null;
}>> {
    const results = new Map();
    
    if (!isConnected || contactIds.length === 0) {
        return results;
    }

    try {
        // Get last online for each contact
        const lastOnlineAgg = await ActivityRecord.aggregate([
            { $match: { contactId: { $in: contactIds }, state: { $regex: /Online/i } } },
            { $sort: { timestamp: -1 } },
            { $group: { _id: '$contactId', lastSeenOnline: { $first: '$timestamp' } } }
        ]);

        // Get last activity for each contact
        const lastActivityAgg = await ActivityRecord.aggregate([
            { $match: { contactId: { $in: contactIds } } },
            { $sort: { timestamp: -1 } },
            { $group: { 
                _id: '$contactId', 
                lastActivity: { $first: '$timestamp' },
                currentState: { $first: '$state' }
            } }
        ]);

        // Build result map
        const onlineMap = new Map(lastOnlineAgg.map(r => [r._id, r.lastSeenOnline]));
        const activityMap = new Map(lastActivityAgg.map(r => [r._id, { lastActivity: r.lastActivity, currentState: r.currentState }]));

        for (const contactId of contactIds) {
            results.set(contactId, {
                lastSeenOnline: onlineMap.get(contactId) || null,
                lastActivity: activityMap.get(contactId)?.lastActivity || null,
                currentState: activityMap.get(contactId)?.currentState || null
            });
        }

        return results;
    } catch (error) {
        console.error('[DB] Failed to get last seen batch:', error);
        return results;
    }
}

