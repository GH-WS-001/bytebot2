# Bytebot PostgreSQL 镜像安装说明

## 文件信息

- **文件名**: `bytebot-postgres.tar.gz`
- **大小**: 99MB
- **镜像**: `postgres:16-alpine`
- **用途**: Bytebot 数据库服务

## 在另一台电脑上安装

### 1. 传输文件

将 `bytebot-postgres.tar.gz` 文件传输到目标电脑。

### 2. 解压并加载镜像

```bash
# 解压文件
gunzip bytebot-postgres.tar.gz

# 加载 Docker 镜像
docker load -i bytebot-postgres.tar

# 验证镜像已加载
docker images | grep postgres
```

### 3. 启动服务

#### 方式一：使用 docker run

```bash
docker run -d \
  --name bytebot-postgres \
  --restart unless-stopped \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=bytebotdb \
  -v postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine
```

#### 方式二：使用 docker-compose

创建 `docker-compose.yml` 文件：

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: bytebot-postgres
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_USER=postgres
      - POSTGRES_DB=bytebotdb
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

启动服务：

```bash
docker-compose up -d
```

### 4. 验证服务

```bash
# 检查容器状态
docker ps | grep bytebot-postgres

# 检查日志
docker logs bytebot-postgres

# 连接数据库
docker exec -it bytebot-postgres psql -U postgres -d bytebotdb
```

## 数据库连接信息

- **主机**: localhost (或容器 IP)
- **端口**: 5432
- **用户名**: postgres
- **密码**: postgres
- **数据库**: bytebotdb

## 数据持久化

数据存储在 Docker volume `postgres_data` 中，即使容器删除，数据也不会丢失。

### 备份数据

```bash
# 导出数据库
docker exec bytebot-postgres pg_dump -U postgres bytebotdb > backup.sql

# 导入数据库
docker exec -i bytebot-postgres psql -U postgres bytebotdb < backup.sql
```

### 清理数据

```bash
# 停止并删除容器
docker stop bytebot-postgres
docker rm bytebot-postgres

# 删除数据卷（会删除所有数据）
docker volume rm postgres_data
```

## 常见问题

### 1. 端口冲突

如果 5432 端口已被占用，可以修改端口映射：

```bash
docker run -d \
  --name bytebot-postgres \
  -p 5433:5432 \
  ...其他参数...
  postgres:16-alpine
```

然后使用端口 5433 连接数据库。

### 2. 权限问题

如果遇到权限问题，确保 Docker 有足够的权限：

```bash
# Linux
sudo docker load -i bytebot-postgres.tar

# macOS/Windows
docker load -i bytebot-postgres.tar
```

### 3. 网络问题

如果需要让其他容器访问数据库，创建网络：

```bash
# 创建网络
docker network create bytebot-network

# 启动容器时连接到网络
docker run -d \
  --name bytebot-postgres \
  --network bytebot-network \
  ...其他参数...
  postgres:16-alpine
```

## 技术支持

如有问题，请查看日志：

```bash
docker logs bytebot-postgres
```

或联系技术支持。
