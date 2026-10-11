"""PostgreSQL persistence for virtual Block Cash rounds; no wallet writes."""
import json
from api import demo_blocks

def handle(request, action, data, database, error):
    user = request.user()
    fields = {'start': {'requestId','entry'}, 'move': {'requestId','roundId','revision','piece','x','y'}, 'finish': {'requestId','roundId','revision'}, 'state': set()}
    if action not in fields: raise error(404, 'Rota não encontrada')
    if set(data) - fields[action]: raise error(422, 'Campos não permitidos. O servidor calcula o resultado.')
    request_id = data.get('requestId')
    if action != 'state' and (not isinstance(request_id,str) or not 8 <= len(request_id) <= 100):
        raise error(422, 'Identificador inválido')
    payload = json.dumps([action,data],sort_keys=True)
    with database() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS demo_block_rounds(user_id BIGINT PRIMARY KEY REFERENCES users(id),state TEXT NOT NULL,last_request TEXT,last_payload TEXT)')
        # Lock the owner as well as the round to serialize concurrent first starts.
        conn.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user['id'],))
        row = conn.execute('SELECT * FROM demo_block_rounds WHERE user_id=%s FOR UPDATE',(user['id'],)).fetchone()
        current = json.loads(row['state']) if row else None
        if action == 'state':
            state = current
        elif row and row['last_request'] == request_id:
            if row['last_payload'] != payload: raise error(409, 'Identificador reutilizado')
            state = current
        else:
            try:
                if action == 'start':
                    if current and current['status'] == 'active': raise error(409, 'Retome a partida ativa.')
                    state = demo_blocks.new_game(data.get('entry'))
                else:
                    if not current or current['id'] != data.get('roundId'): raise error(404, 'Partida não encontrada')
                    if type(data.get('revision')) is not int or current['revision'] != data['revision']: raise error(409, 'Partida desatualizada. Sincronize.')
                    state = demo_blocks.advance(current,action,data)
            except ValueError as exc:
                raise error(422,str(exc))
            conn.execute('INSERT INTO demo_block_rounds(user_id,state,last_request,last_payload) VALUES(%s,%s,%s,%s) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,last_request=excluded.last_request,last_payload=excluded.last_payload',(user['id'],json.dumps(state),request_id,payload))
    request.send_json(200, {'state':state})
