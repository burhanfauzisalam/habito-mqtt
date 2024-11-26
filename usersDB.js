const { queryDatabase } = require("./db");

const createUsersTable = async() => {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username varchar(50) NOT NULL UNIQUE,
      password varchar(255) NOT NULL,
      created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP
        )
  `;

  // Query untuk memasukkan data admin default
  const insert = `
    INSERT IGNORE INTO users (
      username, password
    ) VALUES (?, ?)
  `;

  // Array values berisi data yang akan disisipkan ke tabel
  const value1 = ['habito_001', '123'];
  const value2 = ['habito_002', '123'];
  const value3 = ['habito_003', '123'];
  const value4 = ['habito_004', '123'];
  const value5 = ['habito_005', '123'];

  try {
    // Menjalankan query untuk membuat tabel
    await queryDatabase(sql);
    await queryDatabase(insert, value1);
    await queryDatabase(insert, value2);
    await queryDatabase(insert, value3);
    await queryDatabase(insert, value4);
    await queryDatabase(insert, value5);
    console.log("Table 'users' created successfully or already exists.");
  } catch (err) {
    console.error("Error creating table: ", err);
  }
};

module.exports = createUsersTable;
