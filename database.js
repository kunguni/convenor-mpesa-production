require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "postgres",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,

    ssl: {
        rejectUnauthorized: false
    }
});

// Convert SQLite-style ? placeholders to PostgreSQL $1, $2, $3...
function convertPlaceholders(sql) {
    let index = 0;

    return sql.replace(/\?/g, () => {
        index++;
        return `$${index}`;
    });
}

// Compatibility layer for the existing server.js
const db = {
    prepare(sql) {

        const convertedSql = convertPlaceholders(sql);

        return {

            async get(...params) {
                const result = await pool.query(
                    convertedSql,
                    params
                );

                return result.rows[0];
            },

            async all(...params) {
                const result = await pool.query(
                    convertedSql,
                    params
                );

                return result.rows;
            },

            async run(...params) {
                const result = await pool.query(
                    convertedSql,
                    params
                );

                return {
                    changes: result.rowCount
                };
            }
        };
    }
};


// Test database connection
async function testConnection() {
    try {

        const result = await pool.query(
            "SELECT NOW() AS current_time"
        );

        console.log("=================================");
        console.log("✅ SUPABASE DATABASE CONNECTED");
        console.log("=================================");
        console.log("Database time:", result.rows[0].current_time);

    } catch (error) {

        console.error("=================================");
        console.error("❌ SUPABASE CONNECTION FAILED");
        console.error("=================================");
        console.error(error.message);
    }
}

testConnection();

module.exports = db;