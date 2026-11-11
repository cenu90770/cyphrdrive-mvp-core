-- ============================================================================
-- CyphrDrive(R) Seed Data
-- ============================================================================

-- 1. Insert Branches
INSERT INTO branches (id, name, code, address, city, country, location, contact_phone, contact_email)
VALUES 
(
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'Berlin Central Station Hub',
    'BER-CENTRAL',
    'Europaplatz 1',
    'Berlin',
    'Germany',
    ST_SetSRID(ST_MakePoint(13.3695, 52.5256), 4326),
    '+49 30 11223344',
    'berlin.central@cyphrdrive.io'
),
(
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
    'Berlin Brandenburg Airport (BER)',
    'BER-AIRPORT',
    'Melli-Beese-Ring 1',
    'Schönefeld',
    'Germany',
    ST_SetSRID(ST_MakePoint(13.5180, 52.3667), 4326),
    '+49 30 55667788',
    'berlin.airport@cyphrdrive.io'
);

-- 2. Insert Users
-- Passwords are all: 'Password123!' (Pre-hashed using Argon2id)
-- Hash: $argon2id$v=19$m=65536,t=3,p=4$2q6Q... (Simulated placeholder for verification)
INSERT INTO users (id, email, phone_number, password_hash, first_name, last_name, role, kyc_status, mfa_enabled)
VALUES
(
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01',
    'superadmin@cyphrdrive.io',
    '+491510000001',
    '$argon2id$v=19$m=65536,t=3,p=4$qV9u5Z+fR7N3Y+l/aA1B1Q$9+rS+y9o/9V2N9P9Q0R1S2T3U4V5W6X7Y8Z9a0b1c2d',
    'Alexander',
    'Vance',
    'SUPER_ADMIN',
    'VERIFIED',
    TRUE
),
(
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
    'fleet.admin@cyphrdrive.io',
    '+491510000002',
    '$argon2id$v=19$m=65536,t=3,p=4$qV9u5Z+fR7N3Y+l/aA1B1Q$9+rS+y9o/9V2N9P9Q0R1S2T3U4V5W6X7Y8Z9a0b1c2d',
    'Marcus',
    'Lindner',
    'FLEET_ADMIN',
    'VERIFIED',
    TRUE
),
(
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03',
    'customer.verified@gmail.com',
    '+491510000003',
    '$argon2id$v=19$m=65536,t=3,p=4$qV9u5Z+fR7N3Y+l/aA1B1Q$9+rS+y9o/9V2N9P9Q0R1S2T3U4V5W6X7Y8Z9a0b1c2d',
    'Elena',
    'Rostova',
    'RENTER',
    'VERIFIED',
    FALSE
),
(
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a04',
    'customer.unverified@gmail.com',
    '+491510000004',
    '$argon2id$v=19$m=65536,t=3,p=4$qV9u5Z+fR7N3Y+l/aA1B1Q$9+rS+y9o/9V2N9P9Q0R1S2T3U4V5W6X7Y8Z9a0b1c2d',
    'Jan',
    'Mueller',
    'RENTER',
    'UNVERIFIED',
    FALSE
);

-- 3. Assign Fleet Admin to Central Branch (FR-12.1)
INSERT INTO fleet_admin_branches (user_id, branch_id)
VALUES ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

-- 4. Insert Vehicles
INSERT INTO vehicles (id, branch_id, vin, license_plate, make, model, year, category, transmission, fuel_type, seating_capacity, status, base_daily_rate, specs)
VALUES
(
    'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'WBA3A5C50DF123456',
    'B-CD-101E',
    'BMW',
    'i4 eDrive40',
    2024,
    'Electric Sedan',
    'AUTOMATIC',
    'ELECTRIC',
    5,
    'AVAILABLE',
    119.00,
    '{"range_km": 590, "horsepower": 340, "battery_kwh": 83.9}'::jsonb
),
(
    'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'WAUZZZF28MA098765',
    'B-CD-202X',
    'Audi',
    'Q5 Sportback',
    2023,
    'SUV',
    'AUTOMATIC',
    'DIESEL',
    5,
    'AVAILABLE',
    89.00,
    '{"awd": true, "horsepower": 204, "trunk_liters": 510}'::jsonb
),
(
    'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
    'WVWZZZCDZPW554433',
    'B-CD-303C',
    'Volkswagen',
    'Golf 8 Life',
    2023,
    'Compact',
    'MANUAL',
    'GASOLINE',
    5,
    'AVAILABLE',
    49.00,
    '{"horsepower": 130, "consumption_l_100km": 5.4}'::jsonb
);

-- 5. Insert Sample Telemetry Seed (FR-11.1)
INSERT INTO telemetry_logs (recorded_at, vehicle_id, location, speed_kmh, battery_level, fuel_level, doors_locked, engine_running, odometer, diagnostic_trouble_codes)
VALUES 
(
    NOW() - INTERVAL '2 minutes',
    'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01',
    ST_SetSRID(ST_MakePoint(13.3698, 52.5258), 4326),
    0.0,
    92,
    100,
    TRUE,
    FALSE,
    12450,
    '{}'
);