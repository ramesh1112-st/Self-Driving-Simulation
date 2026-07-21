const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  // Users
  await prisma.user.createMany({
    data: [
      {
        id: "user-admin",
        username: "admin",
        displayName: "Admin Operator",
        password: "admin123",
        role: "admin",
      },
      {
        id: "user-driver",
        username: "driver",
        displayName: "Vehicle Driver",
        password: "driver123",
        role: "driver",
      },
      {
        id: "user-viewer",
        username: "viewer",
        displayName: "Read Only Viewer",
        password: "viewer123",
        role: "viewer",
      },
    ],
    skipDuplicates: true,
  });

  // Vehicles
  await prisma.vehicle.createMany({
    data: [
      { id: "car-01", name: "Car 01" },
      { id: "car-02", name: "Car 02" },
      { id: "car-03", name: "Car 03" },
    ],
    skipDuplicates: true,
  });

  // Permissions
  await prisma.vehiclePermission.createMany({
    data: [
      { userId: "user-admin", vehicleId: "car-01", role: "admin" },
      { userId: "user-admin", vehicleId: "car-02", role: "admin" },
      { userId: "user-admin", vehicleId: "car-03", role: "admin" },

      { userId: "user-driver", vehicleId: "car-01", role: "driver" },
      { userId: "user-driver", vehicleId: "car-02", role: "driver" },

      { userId: "user-viewer", vehicleId: "car-01", role: "viewer" },
    ],
    skipDuplicates: true,
  });

  console.log("Database seeded successfully.");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });