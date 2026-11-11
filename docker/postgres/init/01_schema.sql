-- ============================================================================
-- CyphrDrive(R) Core Schema Initialization
-- Compatible with PostgreSQL 16 + PostGIS + TimescaleDB
-- ============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;

-- 2. Define Custom Enums
CREATE TYPE user_role AS ENUM ('RENTER', 'FLEET_ADMIN', 'SUPER_ADMIN');
CREATE TYPE kyc_status AS ENUM ('UNVERIFIED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');
CREATE TYPE vehicle_status AS ENUM ('AVAILABLE', 'BOOKED', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE', 'SOLD');
CREATE TYPE transmission_type AS ENUM ('AUTOMATIC', 'MANUAL');
CREATE TYPE fuel_type AS ENUM ('GASOLINE', 'DIESEL', 'ELECTRIC', 'HYBRID');
CREATE TYPE booking_status AS ENUM ('HOLD_PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE payment_type AS ENUM ('CARD', 'PRE_AUTH_HOLD', 'INCIDENTAL_CAPTURE', 'REFUND');
CREATE TYPE payment_status AS ENUM ('REQUIRES_PAYMENT_METHOD', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');
CREATE TYPE inspection_type AS ENUM ('PICKUP', 'RETURN');

-- 3. Branches Table (FR-6.4, FR-6.6)
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    code VARCHAR(30) UNIQUE NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    operating_hours JSONB NOT NULL DEFAULT '{"mon_fri": "08:00-20:00", "sat_sun": "09:00-18:00"}'::jsonb,
    contact_phone VARCHAR(50) NOT NULL,
    contact_email VARCHAR(150) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_branches_location ON branches USING GIST (location);

-- 4. Users Table (FR-1, FR-12)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone_number VARCHAR(50) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role user_role NOT NULL DEFAULT 'RENTER',
    kyc_status kyc_status NOT NULL DEFAULT 'UNVERIFIED',
    kyc_verified_at TIMESTAMPTZ,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- 5. Fleet Admin Branch Allocations (FR-12.1 - Multi-branch RBAC/ABAC)
CREATE TABLE fleet_admin_branches (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, branch_id)
);

-- 6. Vehicles Table (FR-2, FR-6)
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    vin VARCHAR(17) UNIQUE NOT NULL,
    license_plate VARCHAR(20) UNIQUE NOT NULL,
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    year INT NOT NULL CHECK (year >= 2000),
    category VARCHAR(50) NOT NULL, -- e.g. 'Compact', 'SUV', 'Sedan', 'Electric'
    transmission transmission_type NOT NULL,
    fuel_type fuel_type NOT NULL,
    seating_capacity INT NOT NULL DEFAULT 5,
    status vehicle_status NOT NULL DEFAULT 'AVAILABLE',
    base_daily_rate NUMERIC(10, 2) NOT NULL CHECK (base_daily_rate > 0),
    mileage_limit_daily INT NOT NULL DEFAULT 200,
    insurance_policy_url TEXT,
    specs JSONB NOT NULL DEFAULT '{}'::jsonb,
    photos TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vehicles_branch_status ON vehicles(branch_id, status);
CREATE INDEX idx_vehicles_category ON vehicles(category);
CREATE INDEX idx_vehicles_price ON vehicles(base_daily_rate);

-- 7. Bookings Table (FR-3, FR-4)
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_reference VARCHAR(12) UNIQUE NOT NULL,
    renter_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
    pickup_branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    dropoff_branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status booking_status NOT NULL DEFAULT 'HOLD_PENDING',
    base_price NUMERIC(10, 2) NOT NULL,
    add_ons_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    taxes_fees NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_price NUMERIC(10, 2) NOT NULL,
    security_deposit NUMERIC(10, 2) NOT NULL DEFAULT 500.00,
    add_ons JSONB NOT NULL DEFAULT '[]'::jsonb, -- e.g. [{"type": "GPS", "cost": 15.00}]
    hold_expires_at TIMESTAMPTZ, -- for 15-minute temporary reservation TTL
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_booking_dates CHECK (end_time > start_time)
);

CREATE INDEX idx_bookings_vehicle_dates ON bookings(vehicle_id, start_time, end_time);
CREATE INDEX idx_bookings_renter ON bookings(renter_id);
CREATE INDEX idx_bookings_status ON bookings(status);

-- 8. Payment Transactions Table (FR-4)
CREATE TABLE payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    gateway_transaction_id VARCHAR(100) NOT NULL, -- e.g. Stripe PaymentIntent ID
    type payment_type NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    status payment_status NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_booking ON payment_transactions(booking_id);
CREATE INDEX idx_payment_gateway_id ON payment_transactions(gateway_transaction_id);

-- 9. Check-In & Return Inspection Records (FR-7.3, FR-8.1)
CREATE TABLE inspection_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
    inspector_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    type inspection_type NOT NULL,
    odometer_reading INT NOT NULL CHECK (odometer_reading >= 0),
    fuel_percentage INT NOT NULL CHECK (fuel_percentage BETWEEN 0 AND 100),
    photos JSONB NOT NULL DEFAULT '{"front": null, "back": null, "left": null, "right": null}'::jsonb,
    remarks TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspections_booking ON inspection_records(booking_id);

-- 10. Immutable Audit Trail (NFR-7.1)
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_recorded_at ON audit_logs(recorded_at DESC);

-- 11. Real-Time Telematics Logs (FR-11.1 - TimescaleDB Hypertable)
CREATE TABLE telemetry_logs (
    recorded_at TIMESTAMPTZ NOT NULL,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    speed_kmh NUMERIC(5, 2) DEFAULT 0.00,
    battery_level INT CHECK (battery_level BETWEEN 0 AND 100),
    fuel_level INT CHECK (fuel_level BETWEEN 0 AND 100),
    doors_locked BOOLEAN NOT NULL DEFAULT TRUE,
    engine_running BOOLEAN NOT NULL DEFAULT FALSE,
    odometer INT NOT NULL CHECK (odometer >= 0),
    diagnostic_trouble_codes TEXT[] NOT NULL DEFAULT '{}'
);

-- Convert to TimescaleDB Hypertable partitioned by time (7-day chunks)
SELECT create_hypertable('telemetry_logs', 'recorded_at', chunk_time_interval => INTERVAL '7 days');

CREATE INDEX idx_telemetry_vehicle_time ON telemetry_logs (vehicle_id, recorded_at DESC);