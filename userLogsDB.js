const { queryDatabase } = require("./db");

const createUserLogsTable = async() => {
  const sql = `
    CREATE TABLE IF NOT EXISTS user_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      custom_id VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  try {
    // Menjalankan query untuk membuat tabel
    await queryDatabase(sql);
    console.log("Table 'user_logs' created successfully or already exists.");
  } catch (err) {
    console.error("Error creating table: ", err);
  }
};

module.exports = createUserLogsTable;
