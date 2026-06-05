-- Mouth Exercises Game — SQL Server schema
-- 在 SQL Server Management Studio (SSMS) 或 sqlcmd 對「目標資料庫」執行一次即可。

-- 1) 建立資料庫(若你已有資料庫,跳過這一步並改 USE 你的)
-- CREATE DATABASE MouthExercisesDb;
-- GO
-- USE MouthExercisesDb;
-- GO

-- 2) 結算統計主表
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GameSessions')
BEGIN
    CREATE TABLE dbo.GameSessions (
        Id              BIGINT IDENTITY(1,1) PRIMARY KEY,
        PlayerName      NVARCHAR(50)   NOT NULL,
        Mode            NVARCHAR(20)   NOT NULL,   -- 'tongue' | 'mouth' | 'voice'
        Difficulty      NVARCHAR(20)   NOT NULL,   -- 'tutorial' | 'easy' | 'medium' | 'hard'
        TotalSuccess    INT            NOT NULL,
        TotalFail       INT            NOT NULL,
        AchievementRate DECIMAL(5,2)   NOT NULL,   -- 0.00 ~ 100.00
        PlayedAt        DATETIME2(0)   NOT NULL,
        RawStatsJson    NVARCHAR(MAX)  NOT NULL,   -- 完整的 gameStats JSON
        CreatedAt       DATETIME2(0)   NOT NULL CONSTRAINT DF_GameSessions_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END
GO

-- 3) 索引:依玩家撈最近紀錄、依模式排行
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GameSessions_Player')
    CREATE INDEX IX_GameSessions_Player ON dbo.GameSessions (PlayerName, CreatedAt DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_GameSessions_Mode')
    CREATE INDEX IX_GameSessions_Mode ON dbo.GameSessions (Mode, AchievementRate DESC, CreatedAt DESC);
GO

-- 驗證
-- SELECT TOP 10 * FROM dbo.GameSessions ORDER BY CreatedAt DESC;
