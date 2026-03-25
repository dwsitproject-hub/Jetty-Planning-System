-- Seed one user for login testing (Step 1.8). Password is plain for now; will hash in 1.9.
-- Username: admin  Password: admin123
INSERT INTO users (username, display_name, email, password_hash, is_active)
VALUES ('admin', 'Admin User', 'admin@example.com', 'admin123', TRUE)
ON CONFLICT (username) DO NOTHING;
