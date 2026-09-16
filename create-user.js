const bcrypt = require("bcryptjs");
const db = require("./database");

const username = "admin";
const password = "Convenor@2026";

const hashedPassword = bcrypt.hashSync(password, 12);

try {

    db.prepare(`
        INSERT INTO users (username, password)
        VALUES (?, ?)
    `).run(username, hashedPassword);

    console.log("=================================");
    console.log("USER CREATED SUCCESSFULLY");
    console.log("=================================");
    console.log("Username:", username);
    console.log("Password:", password);
    console.log("=================================");

} catch (error) {

    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        console.log("User already exists.");
    } else {
        console.error(error);
    }

}