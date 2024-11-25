const { queryDatabase } = require("./db");

const createUsersTable = async() => {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username varchar(50) NOT NULL,
      password varchar(255) NOT NULL,
      created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP
        )
  `;

  try {
    // Menjalankan query untuk membuat tabel
    await queryDatabase(sql);
    console.log("Table 'users' created successfully or already exists.");
  } catch (err) {
    console.error("Error creating table: ", err);
  }
};

module.exports = createUsersTable;
