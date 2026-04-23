import { writeCatalogToDatabase } from "@/server/search/player-repository";

void writeCatalogToDatabase()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
