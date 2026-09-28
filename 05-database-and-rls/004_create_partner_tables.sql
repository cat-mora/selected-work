-- Migration: Create Partner Linking Tables
-- Description: Creates tables for partner invitation codes and user partnerships
-- Version: 004

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: partner_invitations
-- Purpose: Stores short-lived invitation codes for partner linking
-- RLS: Users can only see/manage their own invitations
CREATE TABLE IF NOT EXISTS partner_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(8) NOT NULL UNIQUE,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_used BOOLEAN DEFAULT false,
  accepted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table: user_partnerships
-- Purpose: Maintains links between partnered users
-- RLS: Users can only see partnerships they're part of
CREATE TABLE IF NOT EXISTS user_partnerships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT unique_partnership UNIQUE (user_id, partner_id),
  CONSTRAINT no_self_partnership CHECK (user_id != partner_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_partner_invitations_code ON partner_invitations(code);
CREATE INDEX IF NOT EXISTS idx_partner_invitations_created_by ON partner_invitations(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_partner_invitations_expires_at ON partner_invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_partnerships_user_id ON user_partnerships(user_id);
CREATE INDEX IF NOT EXISTS idx_user_partnerships_partner_id ON user_partnerships(partner_id);

-- Row Level Security
ALTER TABLE partner_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_partnerships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own invitations" ON partner_invitations
  FOR SELECT USING (auth.uid() = created_by_user_id);

CREATE POLICY "Users can create invitations" ON partner_invitations
  FOR INSERT WITH CHECK (auth.uid() = created_by_user_id);

CREATE POLICY "Users can update their own invitations" ON partner_invitations
  FOR UPDATE USING (auth.uid() = created_by_user_id);

CREATE POLICY "Users can view their partnerships" ON user_partnerships
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = partner_id);

CREATE POLICY "Users can create partnerships" ON user_partnerships
  FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.uid() = partner_id);

-- Keep updated_at honest without relying on every writer
CREATE OR REPLACE FUNCTION update_partner_invitations_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_invitations_updated_at_trigger
  BEFORE UPDATE ON partner_invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_partner_invitations_timestamp();
