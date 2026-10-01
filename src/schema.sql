CREATE DATABASE IF NOT EXISTS cricscore;
USE cricscore;

CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
  id VARCHAR(36) PRIMARY KEY,
  team_id VARCHAR(36),
  name VARCHAR(100) NOT NULL,
  nickname VARCHAR(100),
  mobile VARCHAR(20),
  photo TEXT,
  roles JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

-- Existing databases: ALTER TABLE players ADD COLUMN mobile VARCHAR(20) AFTER nickname;

CREATE TABLE IF NOT EXISTS matches (
  id VARCHAR(36) PRIMARY KEY,
  team1_id VARCHAR(36),
  team2_id VARCHAR(36),
  team1_name VARCHAR(100),
  team2_name VARCHAR(100),
  overs INT NOT NULL,
  match_type ENUM('local','domestic') DEFAULT 'local',
  toss_winner VARCHAR(100),
  toss_choice ENUM('bat','field'),
  bet_type ENUM('free','paid') DEFAULT 'free',
  bet_amount INT DEFAULT 0,
  cap1_photo TEXT,
  cap2_photo TEXT,
  status ENUM('live','completed') DEFAULT 'live',
  result VARCHAR(200) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team1_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (team2_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS innings (
  id VARCHAR(36) PRIMARY KEY,
  match_id VARCHAR(36) NOT NULL,
  innings_number INT DEFAULT 1,
  batting_team_id VARCHAR(36),
  bowling_team_id VARCHAR(36),
  batting_team_name VARCHAR(100),
  total_runs INT DEFAULT 0,
  total_wickets INT DEFAULT 0,
  overs_played INT DEFAULT 0,
  balls_played INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batting_scores (
  id VARCHAR(36) PRIMARY KEY,
  innings_id VARCHAR(36) NOT NULL,
  player_name VARCHAR(100) NOT NULL,
  runs INT DEFAULT 0,
  balls INT DEFAULT 0,
  fours INT DEFAULT 0,
  sixes INT DEFAULT 0,
  is_out BOOLEAN DEFAULT FALSE,
  how_out VARCHAR(100),
  FOREIGN KEY (innings_id) REFERENCES innings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bowling_scores (
  id VARCHAR(36) PRIMARY KEY,
  innings_id VARCHAR(36) NOT NULL,
  player_name VARCHAR(100) NOT NULL,
  overs INT DEFAULT 0,
  balls INT DEFAULT 0,
  runs INT DEFAULT 0,
  wickets INT DEFAULT 0,
  FOREIGN KEY (innings_id) REFERENCES innings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS balls (
  id VARCHAR(36) PRIMARY KEY,
  innings_id VARCHAR(36) NOT NULL,
  over_number INT NOT NULL,
  ball_number INT NOT NULL,
  runs INT DEFAULT 0,
  extra_type VARCHAR(10),
  is_wicket BOOLEAN DEFAULT FALSE,
  direction VARCHAR(50),
  batsman_name VARCHAR(100),
  bowler_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (innings_id) REFERENCES innings(id) ON DELETE CASCADE
);
