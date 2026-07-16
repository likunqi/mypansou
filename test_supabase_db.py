import psycopg2

conn = psycopg2.connect(
    host='aws-1-ap-southeast-1.pooler.supabase.com',
    port=5432,
    dbname='postgres',
    user='postgres.ykrvvngruxvjddwloujx',
    password='Srcloud@216',
    connect_timeout=15
)
cur = conn.cursor()

# Get PostgreSQL version
cur.execute('SELECT version()')
print('Connected!')
print('Version:', cur.fetchone()[0])

# List all tables in public schema
cur.execute("""
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
""")
tables = cur.fetchall()
print(f'\nTables in public schema ({len(tables)}):')
for t in tables:
    print(f'   - {t[0]} ({t[1]})')

# If tables exist, get row counts
if tables:
    print()
    for t in tables:
        name = t[0]
        cur.execute(f'SELECT count(*) FROM "{name}"')
        cnt = cur.fetchone()[0]
        print(f'   {name}: {cnt} rows')

cur.close()
conn.close()
print('\nConnection closed')
