const { queryDatabase } = require("./db");

const createLightLogsTable = async() => {
  const sql = `
    CREATE TABLE IF NOT EXISTS light_logs (
      id int NOT NULL,
      username varchar(50) DEFAULT NULL,
      color varchar(20) DEFAULT NULL,
      status enum('ON','OFF') DEFAULT NULL,
      time datetime DEFAULT CURRENT_TIMESTAMP
    )
  `;

  try {
    // Menjalankan query untuk membuat tabel
    await queryDatabase(sql);
    console.log("Table 'light_logs' created successfully or already exists.");
  } catch (err) {
    console.error("Error creating table: ", err);
  }
};

module.exports = createLightLogsTable;
